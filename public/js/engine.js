(function () {
    "use strict";

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makeRng(seed) {
        if (seed === null || seed === undefined) return Math.random;
        const s = Number(seed);
        if (!Number.isFinite(s)) return Math.random;
        return mulberry32(Math.floor(s));
    }

    function expSample(meanSeconds, rng) {
        const u = Math.max(1e-12, 1 - rng());
        return Math.max(0, -meanSeconds * Math.log(u));
    }

    function randomServiceTime(meanSeconds, serviceDistribution, rng) {
        const base = Math.max(1e-9, meanSeconds);
        if (serviceDistribution === "deterministic") return base;
        if (serviceDistribution === "exponential") return Math.max(1e-9, expSample(base, rng));
        // uniform around mean: [0.5*mean, 1.5*mean]
        const min = base * 0.5;
        const max = base * 1.5;
        return min + rng() * (max - min);
    }

    function overlapSeconds(prevTime, nowTime, startTime) {
        if (nowTime <= startTime) return 0;
        const a = Math.max(prevTime, startTime);
        return Math.max(0, nowTime - a);
    }

    function percentile(values, p) {
        if (!values || values.length === 0) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        const w = idx - lo;
        return sorted[lo] * (1 - w) + sorted[hi] * w;
    }

    function tCritical95(df) {
        // 95% CI two-sided => t_{0.975, df}
        const table = {
            1: 12.706,
            2: 4.303,
            3: 3.182,
            4: 2.776,
            5: 2.571,
            6: 2.447,
            7: 2.365,
            8: 2.306,
            9: 2.262,
            10: 2.228,
            11: 2.201,
            12: 2.179,
            13: 2.160,
            14: 2.145,
            15: 2.131,
            16: 2.120,
            17: 2.110,
            18: 2.101,
            19: 2.093,
            20: 2.086,
            21: 2.080,
            22: 2.074,
            23: 2.069,
            24: 2.064,
            25: 2.060,
            26: 2.056,
            27: 2.052,
            28: 2.048,
            29: 2.045,
            30: 2.042,
        };
        if (!Number.isFinite(df) || df <= 0) return 1.96;
        if (df >= 30) return 1.96;
        return table[Math.floor(df)] || 1.96;
    }

    /**
     * ENGINE - Bộ xử lý mô phỏng hàng đợi
     * - Tick rời rạc theo thời gian (Δt)
     * - Sinh khách theo xác suất (xấp xỉ Poisson)
     * - Phân phối vào 1 hàng chung FIFO hoặc nhiều hàng theo quầy
     */
    class SimulationEngine {
        constructor() {
            this.TICK_SECONDS = 1;
            this.reset({
                servers: 2,
                meanInterArrivalSeconds: 4,
                meanServiceSeconds: 20,
                policy: "single_queue_fifo",
                arrivalDistribution: "exponential",
                serviceDistribution: "uniform",
                priorityEnabled: false,
                priorityProbability: 0.1,
                priorityRule: "priority_then_fifo",
                maxQueue: 0,
                patienceSeconds: 0,
                seed: null,
            });
        }

        reset(config) {
            this.config = {
                servers: clamp(Number(config.servers) || 1, 1, 6),
                meanInterArrivalSeconds: Math.max(1, Number(config.meanInterArrivalSeconds) || 4),
                meanServiceSeconds: Math.max(1, Number(config.meanServiceSeconds) || 20),
                policy: config.policy || "single_queue_fifo",
                arrivalDistribution: config.arrivalDistribution === "bernoulli_tick" ? "bernoulli_tick" : "exponential",
                serviceDistribution: ["uniform", "exponential", "deterministic"].includes(config.serviceDistribution)
                    ? config.serviceDistribution
                    : "uniform",
                priorityEnabled: Boolean(config.priorityEnabled),
                priorityProbability: clamp(Number(config.priorityProbability) || 0, 0, 1),
                priorityRule: config.priorityRule || "priority_then_fifo",
                maxQueue: Math.max(0, Math.floor(Number(config.maxQueue) || 0)),
                patienceSeconds: Math.max(0, Number(config.patienceSeconds) || 0),
                seed: config.seed === null || config.seed === undefined ? null : Number(config.seed),
            };

            this.rng = makeRng(this.config.seed);

            this.simTime = 0;
            this.measureStartTime = 0;
            this.totalArrived = 0;
            this.totalServed = 0;
            this.totalBalked = 0;
            this.totalReneged = 0;

            this.totalWaitTime = 0;
            this.waitCount = 0;

            this.queueLengthArea = 0;
            this.maxQueueLength = 0;

            this.waitSamples = [];

            // histories for window/snapshot stats
            this.queueHistory = [];
            this.busyHistory = [];
            this.arrivalEvents = [];
            this.servedEvents = [];
            this.balkedEvents = [];
            this.renegedEvents = [];
            this.waitEvents = [];

            this.nextCustomerId = 1;

            this.recentServed = [];

            this.servers = [];
            for (let i = 0; i < this.config.servers; i++) {
                this.servers.push({
                    id: i + 1,
                    current: null,
                    remainingService: 0,
                    totalBusyTime: 0,
                    completed: 0,
                    queue: [], // dùng cho multi-queue
                });
            }

            this.singleQueue = [];

            // arrival scheduling
            this.nextArrivalTime = this.config.arrivalDistribution === "exponential"
                ? expSample(this.config.meanInterArrivalSeconds, this.rng)
                : null;
        }

        _pushCapped(list, item, cap) {
            list.push(item);
            const limit = cap || 5000;
            if (list.length > limit) list.splice(0, list.length - limit);
        }

        _countInWindow(events, startTime, endTime) {
            let c = 0;
            for (let i = events.length - 1; i >= 0; i--) {
                const t = events[i];
                if (t > endTime) continue;
                if (t < startTime) break;
                c += 1;
            }
            return c;
        }

        _valuesInWindow(pairs, startTime, endTime, key) {
            const out = [];
            for (let i = pairs.length - 1; i >= 0; i--) {
                const p = pairs[i];
                if (p.t > endTime) continue;
                if (p.t < startTime) break;
                out.push(p[key]);
            }
            return out;
        }

        computeWindowStats(winSeconds) {
            const endTime = this.simTime;
            const s = Math.max(1, Number(winSeconds) || 60);
            const startTime = Math.max(this.measureStartTime, endTime - s);
            return this.computeStatsSince(startTime);
        }

        computeStatsSince(startTime) {
            const endTime = this.simTime;
            const start = Math.max(this.measureStartTime, Number(startTime) || 0);
            const dur = Math.max(1e-9, endTime - start);
            const n = this.servers.length;

            const arrived = this._countInWindow(this.arrivalEvents, start, endTime);
            const served = this._countInWindow(this.servedEvents, start, endTime);
            const balked = this._countInWindow(this.balkedEvents, start, endTime);
            const reneged = this._countInWindow(this.renegedEvents, start, endTime);

            const qVals = this._valuesInWindow(this.queueHistory, start, endTime, "q");
            const bVals = this._valuesInWindow(this.busyHistory, start, endTime, "busy");
            const wVals = this._valuesInWindow(this.waitEvents, start, endTime, "wait");

            const avgQueueLength = qVals.length ? (qVals.reduce((a, b) => a + b, 0) / qVals.length) : 0;
            const utilAvg = bVals.length && n > 0 ? ((bVals.reduce((a, b) => a + b, 0) / bVals.length) / n) * 100 : 0;
            const avgWait = wVals.length ? (wVals.reduce((a, b) => a + b, 0) / wVals.length) : 0;

            const waitP50 = percentile(wVals, 0.5);
            const waitP90 = percentile(wVals, 0.9);

            const lambdaObs = arrived / dur;
            const throughput = served / dur;
            const muPerServer = n > 0 ? served / (n * dur) : 0;

            return {
                startTime: start,
                endTime,
                duration: dur,
                arrived,
                served,
                balked,
                reneged,
                avgQueueLength,
                utilAvg,
                avgWait,
                waitP50,
                waitP90,
                lambdaObs,
                throughput,
                muPerServer,
            };
        }

        startMeasuringFrom(startTime) {
            const t = Number(startTime);
            this.measureStartTime = Number.isFinite(t) ? t : this.simTime;

            // reset counters but keep system state
            this.totalArrived = 0;
            this.totalServed = 0;
            this.totalBalked = 0;
            this.totalReneged = 0;
            this.totalWaitTime = 0;
            this.waitCount = 0;
            this.queueLengthArea = 0;
            this.maxQueueLength = this._effectiveQueueLength();
            this.waitSamples = [];

            for (const s of this.servers) {
                s.totalBusyTime = 0;
                s.completed = 0;
            }

            // reset baseline waiting time for customers already in queue
            const bump = (c) => {
                if (!c) return;
                if (c.arrivalTime < this.measureStartTime) c.arrivalTime = this.measureStartTime;
            };
            for (const c of this.singleQueue) bump(c);
            for (const s of this.servers) {
                for (const c of s.queue) bump(c);
            }
        }

        getState() {
            return {
                config: { ...this.config },
                simTime: this.simTime,
                totalArrived: this.totalArrived,
                totalServed: this.totalServed,
                totalWaitTime: this.totalWaitTime,
                waitCount: this.waitCount,
                queueLengthArea: this.queueLengthArea,
                maxQueueLength: this.maxQueueLength,
                servers: this.servers.map((s) => ({
                    id: s.id,
                    current: s.current ? { ...s.current } : null,
                    remainingService: s.remainingService,
                    totalBusyTime: s.totalBusyTime,
                    completed: s.completed,
                    queueLength: s.queue.length,
                })),
                singleQueueLength: this.singleQueue.length,
                recentServed: [...this.recentServed],
            };
        }

        _effectiveQueueLength() {
            if (this.config.policy === "multi_queue_shortest") {
                return this.servers.reduce((sum, s) => sum + s.queue.length, 0);
            }
            return this.singleQueue.length;
        }

        _enqueue(customer) {
            // Capacity constraint (balking): limit total waiting queue
            const cap = this.config.maxQueue;
            if (cap > 0 && this._effectiveQueueLength() >= cap) {
                this.totalBalked += 1;
                if (this.simTime >= this.measureStartTime) this._pushCapped(this.balkedEvents, this.simTime, 5000);
                return false;
            }

            if (this.config.policy === "multi_queue_shortest") {
                let best = this.servers[0];
                for (const s of this.servers) {
                    if (s.queue.length < best.queue.length) best = s;
                }
                this._enqueueIntoQueue(best.queue, customer);
            } else {
                this._enqueueIntoQueue(this.singleQueue, customer);
            }

            return true;
        }

        _enqueueIntoQueue(queue, customer) {
            if (!this.config.priorityEnabled) {
                queue.push(customer);
                return;
            }

            // Smaller number => higher priority (0 is higher than 1)
            const idx = queue.findIndex((c) => c.priority > customer.priority);
            if (idx === -1) queue.push(customer);
            else queue.splice(idx, 0, customer);
        }

        _dequeueForServer(server) {
            if (this.config.policy === "multi_queue_shortest") {
                return server.queue.shift() || null;
            }
            return this.singleQueue.shift() || null;
        }

        step() {
            const { meanInterArrivalSeconds, meanServiceSeconds, arrivalDistribution, serviceDistribution, patienceSeconds } = this.config;

            const prevTime = this.simTime;
            this.simTime += this.TICK_SECONDS;
            const measuredDt = overlapSeconds(prevTime, this.simTime, this.measureStartTime);

            const qLen = this._effectiveQueueLength();
            this.queueLengthArea += qLen * measuredDt;
            if (qLen > this.maxQueueLength) this.maxQueueLength = qLen;

            // history for window/snapshot stats
            if (this.simTime >= this.measureStartTime) {
                this._pushCapped(this.queueHistory, { t: this.simTime, q: qLen }, 8000);
            }

            // Arrival process
            const arrivals = [];

            const makeCustomer = (arrivalTime) => {
                const isPriority = this.config.priorityEnabled && this.rng() < this.config.priorityProbability;
                return {
                    id: this.nextCustomerId++,
                    arrivalTime,
                    priority: isPriority ? 0 : 1,
                };
            };

            if (arrivalDistribution === "exponential") {
                // allow multiple arrivals within one tick
                while (this.nextArrivalTime !== null && this.nextArrivalTime <= this.simTime) {
                    const tArrival = this.nextArrivalTime;
                    const customer = makeCustomer(tArrival);
                    const enq = this._enqueue(customer);
                    if (enq && tArrival >= this.measureStartTime) this.totalArrived += 1;
                    if (enq) arrivals.push(customer);
                    if (enq && tArrival >= this.measureStartTime) this._pushCapped(this.arrivalEvents, tArrival, 8000);
                    this.nextArrivalTime += expSample(meanInterArrivalSeconds, this.rng);
                }
            } else {
                // Bernoulli per tick (simple)
                const lambda = 1 / meanInterArrivalSeconds; // customers/second
                const probArrival = Math.min(0.95, lambda * this.TICK_SECONDS);
                if (this.rng() < probArrival) {
                    const customer = makeCustomer(this.simTime);
                    const enq = this._enqueue(customer);
                    if (enq && this.simTime >= this.measureStartTime) this.totalArrived += 1;
                    if (enq) arrivals.push(customer);
                    if (enq && this.simTime >= this.measureStartTime) this._pushCapped(this.arrivalEvents, this.simTime, 8000);
                }
            }

            // Reneging (patience): remove customers that waited too long
            if (patienceSeconds > 0) {
                const now = this.simTime;
                const shouldLeave = (c) => now - c.arrivalTime >= patienceSeconds;
                const processQueue = (queue) => {
                    if (!queue || queue.length === 0) return;
                    // keep stable order of remaining
                    const kept = [];
                    for (const c of queue) {
                        if (shouldLeave(c)) {
                            if (now >= this.measureStartTime) this.totalReneged += 1;
                            if (now >= this.measureStartTime) this._pushCapped(this.renegedEvents, now, 8000);
                        } else {
                            kept.push(c);
                        }
                    }
                    queue.length = 0;
                    for (const c of kept) queue.push(c);
                };

                if (this.config.policy === "multi_queue_shortest") {
                    for (const s of this.servers) processQueue(s.queue);
                } else {
                    processQueue(this.singleQueue);
                }
            }

            const justAssigned = [];
            const justFinished = [];

            // compute busy servers after updates; keep history once per tick
            const countBusyNow = () => this.servers.reduce((sum, s) => sum + (s.current ? 1 : 0), 0);

            // Update servers
            for (const server of this.servers) {
                if (server.current) {
                    server.remainingService -= this.TICK_SECONDS;
                    server.totalBusyTime += measuredDt;

                    if (server.remainingService <= 0) {
                        justFinished.push({ serverId: server.id, customer: server.current });
                        this.recentServed.push({ id: server.current.id, finishedAt: this.simTime });

                        server.current = null;
                        server.remainingService = 0;
                        server.completed += 1;
                        if (this.simTime >= this.measureStartTime) this.totalServed += 1;
                        if (this.simTime >= this.measureStartTime) this._pushCapped(this.servedEvents, this.simTime, 8000);
                    }
                }

                if (!server.current) {
                    const next = this._dequeueForServer(server);
                    if (next) {
                        const wait = this.simTime - next.arrivalTime;
                        if (this.simTime >= this.measureStartTime) {
                            this.totalWaitTime += wait;
                            this.waitCount += 1;
                            if (this.waitSamples.length < 5000) this.waitSamples.push(wait);
                            this._pushCapped(this.waitEvents, { t: this.simTime, wait }, 8000);
                        }

                        server.current = next;
                        server.remainingService = randomServiceTime(meanServiceSeconds, serviceDistribution, this.rng);
                        justAssigned.push({ serverId: server.id, customer: next });
                    }
                }
            }

            if (this.simTime >= this.measureStartTime) {
                this._pushCapped(this.busyHistory, { t: this.simTime, busy: countBusyNow() }, 8000);
            }

            // cleanup recent served (engine-level)
            const now = this.simTime;
            this.recentServed = this.recentServed.filter((c) => now - c.finishedAt < 8);

            return {
                arrivals,
                justAssigned,
                justFinished,
            };
        }

        computeMetrics() {
            const T = this.simTime;
            const n = this.servers.length;

            const measuredT = Math.max(0, T - this.measureStartTime);

            const avgWait = this.waitCount > 0 ? this.totalWaitTime / this.waitCount : 0;
            const avgQueueLength = measuredT > 0 ? this.queueLengthArea / measuredT : 0;
            const totalBusy = this.servers.reduce((sum, s) => sum + s.totalBusyTime, 0);
            const utilAvg = measuredT > 0 && n > 0 ? (totalBusy / (n * measuredT)) * 100 : 0;

            const lambdaObs = measuredT > 0 ? this.totalArrived / measuredT : 0;
            const throughput = measuredT > 0 ? this.totalServed / measuredT : 0;
            const muPerServer = measuredT > 0 && n > 0 ? this.totalServed / (n * measuredT) : 0;

            const waitP50 = percentile(this.waitSamples, 0.5);
            const waitP90 = percentile(this.waitSamples, 0.9);

            return {
                avgWait,
                avgQueueLength,
                utilAvg,
                lambdaObs,
                throughput,
                muPerServer,
                totalBusy,
                balked: this.totalBalked,
                reneged: this.totalReneged,
                waitP50,
                waitP90,
                measuredT,
            };
        }

        buildConclusion() {
            const m = this.computeMetrics();
            const n = this.servers.length;
            const { meanServiceSeconds } = this.config;

            const highWait = m.avgWait > 180 || m.avgQueueLength > 8 || m.utilAvg > 90;
            const veryLowWait = m.avgWait < 60 && m.avgQueueLength < 3 && m.utilAvg < 65;

            if (highWait) {
                const suggestServers = n + 1;

                const reasons = [];
                if (m.avgWait > 180) reasons.push(`chờ TB cao (≈ ${m.avgWait.toFixed(1)}s)`);
                if (m.avgQueueLength > 8) reasons.push(`hàng TB dài (≈ ${m.avgQueueLength.toFixed(2)} SV)`);
                if (m.utilAvg > 90) reasons.push(`mức sử dụng cao (ρ ≈ ${m.utilAvg.toFixed(1)}%)`);
                const reasonText = reasons.length ? reasons.join(", ") : `ρ ≈ ${m.utilAvg.toFixed(1)}%`;

                let suggestedService = Math.max(1, Math.round(meanServiceSeconds * 0.7));
                if (suggestedService >= meanServiceSeconds) {
                    suggestedService = Math.max(1, Math.round(meanServiceSeconds) - 1);
                }

                return (
                    `Kết quả cho thấy hệ thống đang căng tải: ${reasonText}. ` +
                    `Với λ ≈ ${m.lambdaObs.toFixed(3)} SV/giây và năng lực phục vụ n·µ ≈ ${(n * m.muPerServer).toFixed(3)} SV/giây (n = ${n}), ` +
                    `nên cân nhắc tăng số quầy lên khoảng ${suggestServers} quầy hoặc rút ngắn thời gian phục vụ ` +
                    `(ví dụ từ ~${meanServiceSeconds}s xuống ~${suggestedService}s).`
                );
            }

            if (veryLowWait) {
                const possibleServers = Math.max(1, n - 1);
                return (
                    `Thời gian chờ hiện thấp (≈ ${m.avgWait.toFixed(1)}s, hàng TB ≈ ${m.avgQueueLength.toFixed(2)} SV) ` +
                    `trong khi mức sử dụng quầy chỉ khoảng ${m.utilAvg.toFixed(1)}%. ` +
                    `Có thể hệ thống đang dư quầy; thử giảm còn ${possibleServers} quầy để tối ưu nhân lực.`
                );
            }

            return (
                `Các chỉ số cho thấy cấu hình hiện tại khá cân bằng: chờ TB ≈ ${m.avgWait.toFixed(1)}s, ` +
                `hàng đợi TB ≈ ${m.avgQueueLength.toFixed(2)} SV, mức sử dụng ≈ ${m.utilAvg.toFixed(1)}%. ` +
                `Với λ ≈ ${m.lambdaObs.toFixed(3)} SV/giây và n·µ ≈ ${(n * m.muPerServer).toFixed(3)} SV/giây, số quầy hiện tại (${n}) là hợp lý.`
            );
        }

        buildExplainHtml() {
            const m = this.computeMetrics();
            const T = this.simTime;
            const n = this.servers.length;
            const measuredT = m.measuredT;

            return `
                <p><strong>1. Thời gian chờ trung bình</strong><br>
                Gọi <code>W</code> là thời gian chờ trung bình, <code>waitCount</code> là số sinh viên đã được đưa vào quầy,<br>
                <code>totalWaitTime</code> là tổng thời gian chờ của các sinh viên đó (giây).<br>
                Công thức: <code>W = totalWaitTime / waitCount</code><br>
                Với số liệu: <code>totalWaitTime = ${this.totalWaitTime.toFixed(1)}s</code>,
                <code>waitCount = ${this.waitCount}</code> ⇒ <code>W ≈ ${m.avgWait.toFixed(1)}s</code>.</p>

                <p><strong>2. Độ dài hàng đợi trung bình</strong><br>
                Mỗi bước thời gian <code>Δt = ${this.TICK_SECONDS}s</code> ta cộng độ dài hàng đợi hiện tại vào biến
                <code>queueLengthArea</code> (tích phân rời rạc). Gọi <code>L</code> là độ dài hàng đợi trung bình,<br>
                <code>T'</code> là thời gian đo sau warm-up (nếu có).<br>
                Công thức: <code>L = queueLengthArea / T'</code><br>
                Với số liệu: <code>queueLengthArea = ${this.queueLengthArea.toFixed(1)}</code>,
                <code>T' = ${measuredT.toFixed(0)}s</code> ⇒ <code>L ≈ ${m.avgQueueLength.toFixed(2)}</code>,
                độ dài lớn nhất quan sát được: <code>${this.maxQueueLength}</code> sinh viên.</p>

                <p><strong>3. Mức sử dụng quầy trung bình</strong><br>
                Với mỗi quầy <code>i</code>, ta tích lũy thời gian quầy bận vào <code>busyTime[i]</code> (ở đây là <code>server.totalBusyTime</code>).<br>
                Gọi <code>ρ</code> là mức sử dụng trung bình toàn hệ thống, <code>n</code> là số quầy, <code>T'</code> là thời gian đo sau warm-up.<br>
                Công thức: <code>ρ = (∑ busyTime[i]) / (n · T')</code><br>
                Với số liệu: <code>∑busyTime[i] = ${m.totalBusy.toFixed(1)}s</code>, <code>n = ${n}</code>, <code>T' = ${measuredT.toFixed(0)}s</code>
                ⇒ <code>ρ ≈ ${m.utilAvg.toFixed(1)}%</code>.</p>

                <p><strong>4. Ưu tiên &amp; ràng buộc hàng chờ</strong><br>
                Nếu bật <code>priority</code>, khách ưu tiên sẽ đứng trước khách thường, và trong cùng nhóm vẫn theo FIFO (không giành quyền).<br>
                Nếu đặt <code>maxQueue &gt; 0</code>, khi hàng chờ đã đạt giới hạn thì khách mới đến sẽ không vào hệ thống (balking).<br>
                Nếu đặt <code>patienceSeconds &gt; 0</code>, khách chờ quá ngưỡng sẽ rời khỏi hàng (reneging).<br>
                Quan sát: <code>balking = ${m.balked}</code>, <code>reneging = ${m.reneged}</code>.</p>

                <p><strong>5. Phân phối &amp; độ biến động</strong><br>
                Dòng đến: <code>${this.config.arrivalDistribution}</code>, phục vụ: <code>${this.config.serviceDistribution}</code>.<br>
                Thời gian chờ phân vị: <code>P50 ≈ ${m.waitP50.toFixed(1)}s</code>, <code>P90 ≈ ${m.waitP90.toFixed(1)}s</code>.
                Phân vị giúp thấy “đuôi dài” (một số SV chờ rất lâu) mà trung bình có thể che mất.</p>
            `;
        }
    }

    function summarize(values) {
        const n = values.length;
        if (n === 0) return { mean: 0, sd: 0, ciLow: 0, ciHigh: 0 };
        const mean = values.reduce((a, b) => a + b, 0) / n;
        if (n === 1) return { mean, sd: 0, ciLow: mean, ciHigh: mean };
        const varSum = values.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
        const sd = Math.sqrt(varSum / (n - 1));
        const t = tCritical95(n - 1);
        const half = t * (sd / Math.sqrt(n));
        return { mean, sd, ciLow: mean - half, ciHigh: mean + half };
    }

    SimulationEngine.runReplications = function (baseConfig, options) {
        const reps = Math.max(1, Math.floor(Number(options.reps) || 1));
        const runSeconds = Math.max(1, Math.floor(Number(options.runSeconds) || 900));
        const warmupSeconds = Math.max(0, Math.floor(Number(options.warmupSeconds) || 0));
        const baseSeed = options.seed === null || options.seed === undefined ? null : Number(options.seed);

        const perRep = [];
        for (let i = 0; i < reps; i++) {
            const e = new SimulationEngine();
            const seed = baseSeed === null ? null : baseSeed + i * 9973;
            e.reset({ ...baseConfig, seed });

            // warm-up
            for (let t = 0; t < warmupSeconds; t += e.TICK_SECONDS) {
                e.step();
            }
            if (warmupSeconds > 0) e.startMeasuringFrom(e.simTime);

            for (let t = 0; t < runSeconds; t += e.TICK_SECONDS) {
                e.step();
            }

            const m = e.computeMetrics();
            perRep.push({ ...m, seed });
        }

        const pick = (key) => perRep.map((m) => Number(m[key]) || 0);
        const summary = {
            avgWait: summarize(pick("avgWait")),
            avgQueueLength: summarize(pick("avgQueueLength")),
            utilAvg: summarize(pick("utilAvg")),
            throughput: summarize(pick("throughput")),
            lambdaObs: summarize(pick("lambdaObs")),
            balked: summarize(pick("balked")),
            reneged: summarize(pick("reneged")),
            waitP50: summarize(pick("waitP50")),
            waitP90: summarize(pick("waitP90")),
        };

        return {
            reps,
            runSeconds,
            warmupSeconds,
            baseSeed,
            config: { ...baseConfig },
            perRep,
            summary,
        };
    };

    window.SimulationEngine = SimulationEngine;
})();
