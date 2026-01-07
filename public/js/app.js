(function () {
    "use strict";

    function fmt(x, digits) {
        const n = Number(x);
        if (!Number.isFinite(n)) return "0";
        return n.toFixed(digits);
    }

    function tValue95(df) {
        if (!Number.isFinite(df) || df <= 0) return 1.96;
        if (df >= 120) return 1.98;
        if (df >= 60) return 2.00;
        if (df >= 40) return 2.02;
        if (df >= 30) return 2.04;
        if (df >= 20) return 2.09;
        if (df >= 10) return 2.23;
        if (df >= 5) return 2.57;
        return 2.78;
    }

    function analyzeReplications(repMetrics, key) {
        const vals = repMetrics.map((m) => Number(m[key]) || 0);
        const n = vals.length;
        const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, n);
        const varSum = n > 1 ? vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1) : 0;
        const sd = Math.sqrt(varSum);
        const t = tValue95(Math.max(1, n - 1));
        const margin = n > 0 ? (t * sd) / Math.sqrt(n) : 0;
        return { n, mean, sd, margin, ciLow: mean - margin, ciHigh: mean + margin };
    }

    function classify(n, sd, mean, margin) {
        const msgs = [];
        const cv = mean !== 0 ? sd / Math.abs(mean) : 0;
        if (n < 30) msgs.push({ cls: "warn", text: "Số lần mô phỏng < 30 → CI có thể rộng." });
        if (mean !== 0 && cv > 0.3) msgs.push({ cls: "warn", text: "CV > 30% → tăng số lần mô phỏng hoặc điều chỉnh tham số." });
        if (mean !== 0 && margin > Math.abs(mean) * 0.3) msgs.push({ cls: "bad", text: "CI quá rộng so với mean (>30%)." });
        if (msgs.length === 0) msgs.push({ cls: "ok", text: "Chỉ báo thống kê ở mức tốt." });
        return msgs;
    }

    function overallLevelFromTips(tips) {
        if (tips.some((t) => t.cls === "bad")) return { cls: "bad", label: "Kém" };
        if (tips.some((t) => t.cls === "warn")) return { cls: "warn", label: "Trung bình" };
        return { cls: "ok", label: "Tốt" };
    }

    /**
     * APP - Nối INPUT / ENGINE / OUTPUT
     * - setInterval chạy engine.step()
     * - output.render() cập nhật view
     * - dashboard cập nhật biểu đồ thời gian thực
     */
    class App {
        constructor() {
            this.engine = new window.SimulationEngine();
            this.output = new window.OutputRenderer();
            this.dashboard = new window.Dashboard();

            this.input = new window.InputController(this);

            this.timerId = null;
            this.paused = false;

            this.snapshots = [];
            this.replications = [];
            this.lastReplicationMeta = null;

            this.epoch = 0;
            this._initialized = false;

            this.errorModal = document.getElementById("error-modal");
            this.btnErrorClose = document.getElementById("btn-error-close");
            this.errorSummary = document.getElementById("error-summary");
            this.errorAdvice = document.getElementById("error-advice");
            this.repTableBody = document.querySelector("#rep-table tbody");

            if (this.btnErrorClose) {
                this.btnErrorClose.addEventListener("click", () => this._closeErrorModal());
            }

            window.addEventListener("keydown", (e) => this._handleKeydown(e));

            this.reset();
        }

        _handleKeydown(e) {
            if (e.code === "Space") {
                this.togglePause();
                e.preventDefault();
                return;
            }
            if (e.key === "r" || e.key === "R") {
                this.reset();
                return;
            }
            if (e.key === "l" || e.key === "L") {
                this._togglePolicy();
                return;
            }
            if (e.key === "t" || e.key === "T") {
                this._togglePriority();
            }
        }

        _togglePolicy() {
            const sel = document.getElementById("input-policy");
            if (!sel) return;
            sel.value = sel.value === "multi_queue_shortest" ? "single_queue_fifo" : "multi_queue_shortest";
            this.reset();
        }

        _togglePriority() {
            const sel = document.getElementById("input-priority-enabled");
            if (!sel) return;
            sel.value = sel.value === "on" ? "off" : "on";
            this.reset();
        }

        _render(events) {
            const state = this.engine.getState();
            const metrics = this.engine.computeMetrics();
            this.output.render(state, metrics, events);

            // dashboard
            const queueLen = state.config.policy === "multi_queue_shortest"
                ? state.servers.reduce((sum, s) => sum + s.queueLength, 0)
                : state.singleQueueLength;
            this.dashboard.push(state.simTime, queueLen, metrics.avgWait, metrics.utilAvg);
        }

        start() {
            if (this.timerId) return;

            // apply config
            this.engine.reset(this.input.getConfig());
            this.output.hideReport();
            this.dashboard.reset();
            this._render({});

            this.timerId = setInterval(() => {
                if (this.paused) return;
                const events = this.engine.step();
                this._render(events);
            }, this.engine.TICK_SECONDS * 1000);
        }

        stop() {
            clearInterval(this.timerId);
            this.timerId = null;
            this.paused = false;

            const state = this.engine.getState();
            const metrics = this.engine.computeMetrics();
            this.output.render(state, metrics, {});
            this.output.renderReport(this.engine, state, metrics);
        }

        reset() {
            clearInterval(this.timerId);
            this.timerId = null;
            this.paused = false;

            if (this._initialized) this.epoch += 1;
            else {
                this.epoch = 0;
                this._initialized = true;
            }

            this.engine.reset(this.input.getConfig());
            this.output.hideReport();
            this.dashboard.reset();
            this._render({});

            this.snapshots = [];
            this.replications = [];
            this.lastReplicationMeta = null;
            this.output.renderStatsOut("");
        }

        togglePause() {
            if (!this.timerId) return;
            this.paused = !this.paused;
            const state = this.engine.getState();
            this.output.renderStatsOut(this.paused
                ? `<strong>Đang tạm dừng</strong> tại t=${fmt(state.simTime, 0)}s. (Space để tiếp tục)`
                : `<strong>Tiếp tục chạy</strong>...`);
        }

        applyPreset(name) {
            const preset = String(name || "");
            const setVal = (id, v) => {
                const el = document.getElementById(id);
                if (el) el.value = String(v);
            };

            if (preset === "rush") {
                setVal("input-servers", 2);
                setVal("input-arrival", 2);
                setVal("input-service", 22);
                setVal("input-policy", "single_queue_fifo");
                setVal("input-priority-enabled", "on");
                setVal("input-priority-prob", 0.15);
                setVal("input-max-queue", 25);
                setVal("input-patience", 180);
            } else {
                setVal("input-servers", 2);
                setVal("input-arrival", 4);
                setVal("input-service", 20);
                setVal("input-policy", "single_queue_fifo");
                setVal("input-priority-enabled", "off");
                setVal("input-priority-prob", 0.10);
                setVal("input-max-queue", 0);
                setVal("input-patience", 0);
            }

            this.reset();
        }

        showWindowStats() {
            const { errors } = this.input.getConfigWithValidation();
            if (errors.length > 0) return;
            const win = this.input.getWinSeconds();
            const s = this.engine.computeWindowStats(win);

            const html = `
                <div><strong>Thống kê ${fmt(s.duration, 0)}s gần nhất</strong> (từ t=${fmt(s.startTime, 0)}s đến ${fmt(s.endTime, 0)}s)</div>
                <div>Đến: <strong>${s.arrived}</strong> (λ≈${fmt(s.lambdaObs, 3)}/s) • Rời hệ: <strong>${s.served}</strong> (throughput≈${fmt(s.throughput, 3)}/s)</div>
                <div>W≈<strong>${fmt(s.avgWait, 1)}s</strong> • P90≈<strong>${fmt(s.waitP90, 1)}s</strong> • L≈<strong>${fmt(s.avgQueueLength, 2)}</strong> • ρ≈<strong>${fmt(s.utilAvg, 1)}%</strong></div>
                <div>Balking: <strong>${s.balked}</strong> • Reneging: <strong>${s.reneged}</strong></div>
            `;
            this.output.renderStatsOut(html);
        }

        addSnapshot() {
            const { errors } = this.input.getConfigWithValidation();
            if (errors.length > 0) return;
            const labelRaw = this.input.getSnapshotLabel();
            const label = labelRaw ? labelRaw : `Mốc #${this.snapshots.length + 1}`;

            const state = this.engine.getState();
            const snap = {
                id: this.snapshots.length + 1,
                t: state.simTime,
                epoch: this.epoch,
                label,
                config: { ...state.config },
            };
            this.snapshots.push(snap);

            const resetTime = this.input.getSnapshotResetFlag();
            if (resetTime) {
                this.engine.startMeasuringFrom(this.engine.simTime);
            }

            const c = snap.config;
            const priorityText = c.priorityEnabled
                ? `priority=ON(p=${fmt(c.priorityProbability, 2)})`
                : "priority=OFF";
            const capText = (Number(c.maxQueue) || 0) > 0 ? `maxQ=${c.maxQueue}` : "maxQ=∞";
            const patienceText = (Number(c.patienceSeconds) || 0) > 0 ? `patience=${fmt(c.patienceSeconds, 0)}s` : "patience=OFF";

            this.output.renderStatsOut(
                `Đã ghi mốc: <span class="tag">${label}</span> @t=${fmt(snap.t, 1)}s (epoch ${snap.epoch}) • ` +
                `n=${c.servers} • inter-arr=${fmt(c.meanInterArrivalSeconds, 0)}s(${c.arrivalDistribution}) • ` +
                `service=${fmt(c.meanServiceSeconds, 0)}s(${c.serviceDistribution}) • ` +
                `policy=${c.policy} • ${priorityText} • ${capText} • ${patienceText}`
            );
        }

        showStatsBySnapshot() {
            if (this.snapshots.length === 0) {
                this.output.renderStatsOut("Chưa có mốc. Hãy bấm ‘Ghi mốc cấu hình’ trước.");
                return;
            }
            const last = this.snapshots[this.snapshots.length - 1];
            const s = this.engine.computeStatsSince(last.t);
            const html = `
                <div><strong>Thống kê theo mốc:</strong> ${last.label}</div>
                <div>Từ t=${fmt(s.startTime, 0)}s đến ${fmt(s.endTime, 0)}s (Δ=${fmt(s.duration, 0)}s)</div>
                <div>Đến: <strong>${s.arrived}</strong> (λ≈${fmt(s.lambdaObs, 3)}/s) • Rời hệ: <strong>${s.served}</strong> (throughput≈${fmt(s.throughput, 3)}/s)</div>
                <div>W≈<strong>${fmt(s.avgWait, 1)}s</strong> • P90≈<strong>${fmt(s.waitP90, 1)}s</strong> • L≈<strong>${fmt(s.avgQueueLength, 2)}</strong> • ρ≈<strong>${fmt(s.utilAvg, 1)}%</strong></div>
                <div>Balking: <strong>${s.balked}</strong> • Reneging: <strong>${s.reneged}</strong></div>
            `;
            this.output.renderStatsOut(html);
        }

        toggleDashboard() {
            const el = document.getElementById("dashboard-section");
            if (!el) return;
            const isHidden = el.style.display === "none";
            el.style.display = isHidden ? "block" : "none";
        }

        runReplications() {
            const { errors } = this.input.getConfigWithValidation();
            if (errors.length > 0) return;

            const cfg = this.input.getConfig();
            const duration = Math.max(5, Math.floor(this.input.getWinSeconds()));
            const reps = Math.max(5, Math.min(200, Math.floor(this.input.getReplicationCount())));
            const baseSeed = Date.now() >>> 0;

            const result = window.SimulationEngine.runReplications(cfg, {
                reps,
                runSeconds: duration,
                warmupSeconds: 0,
                seed: baseSeed,
            });

            this.replications = result.perRep;
            this.lastReplicationMeta = { reps, duration, baseSeed };

            const a = analyzeReplications(this.replications, "avgWait");
            const html = `
                <div><strong>Đã chạy ${reps} lần</strong> (mỗi lần ${duration}s, base seed ${baseSeed}).</div>
                <div>Gợi ý: bấm “Phân tích lỗi thống kê” để xem CI/độ ổn định; hoặc “Xuất CSV”.</div>
                <div>W mean≈<strong>${fmt(a.mean, 1)}s</strong>, CI≈[${fmt(a.ciLow, 1)}; ${fmt(a.ciHigh, 1)}] (sd≈${fmt(a.sd, 1)}).</div>
            `;
            this.output.renderStatsOut(html);
        }

        showErrorAnalysis() {
            if (!this.replications || this.replications.length === 0) {
                this.output.renderStatsOut("Chưa có dữ liệu replication. Hãy bấm ‘Chạy nhiều lần’ trước.");
                return;
            }

            const focusKeys = [
                { key: "avgWait", name: "W" },
                { key: "avgQueueLength", name: "L" },
                { key: "utilAvg", name: "ρ" },
                { key: "throughput", name: "Throughput" },
            ];
            const analyses = focusKeys.map((k) => ({ ...k, a: analyzeReplications(this.replications, k.key) }));
            const tipsByKey = analyses.map((x) => ({
                name: x.name,
                tips: classify(x.a.n, x.a.sd, x.a.mean, x.a.margin),
            }));
            const allTips = tipsByKey
                .flatMap((t) => t.tips.map((m) => ({ ...m, text: `${t.name}: ${m.text}` })))
                // de-dup identical messages
                .filter((v, idx, arr) => arr.findIndex((u) => u.text === v.text && u.cls === v.cls) === idx);

            const overall = overallLevelFromTips(allTips);
            const aW = analyses[0].a;

            if (this.repTableBody) {
                this.repTableBody.innerHTML = this.replications
                    .map((m, i) => {
                        return `<tr>
                            <td>${i + 1}</td>
                            <td>${m.seed === null || m.seed === undefined ? "-" : String(m.seed)}</td>
                            <td>${fmt(m.avgWait, 1)}</td>
                            <td>${fmt(m.avgQueueLength, 2)}</td>
                            <td>${fmt(m.utilAvg, 1)}</td>
                            <td>${fmt(m.throughput, 3)}</td>
                            <td>${fmt(m.lambdaObs, 3)}</td>
                            <td>${fmt(m.balked, 0)}</td>
                            <td>${fmt(m.reneged, 0)}</td>
                            <td>${fmt(m.waitP90, 1)}</td>
                        </tr>`;
                    })
                    .join("");
            }

            if (this.errorSummary) {
                const meta = this.lastReplicationMeta;
                const lines = analyses.map((x) => {
                    const unit = x.key === "utilAvg" ? "%" : (x.key === "throughput" ? "/s" : (x.key === "avgQueueLength" ? "" : "s"));
                    const digits = x.key === "throughput" ? 3 : (x.key === "avgQueueLength" ? 2 : 1);
                    return `${x.name}: mean=${fmt(x.a.mean, digits)}${unit}, CI=[${fmt(x.a.ciLow, digits)}; ${fmt(x.a.ciHigh, digits)}], sd=${fmt(x.a.sd, digits)}`;
                });

                this.errorSummary.innerHTML = (meta
                    ? `Replication: <strong>${meta.reps}</strong> lần • duration: <strong>${meta.duration}s</strong> • base seed: <strong>${meta.baseSeed}</strong>`
                    : `Replication: <strong>${this.replications.length}</strong> lần`) +
                    ` • Mức đánh giá: <span class="badge ${overall.cls}">${overall.label}</span>` +
                    `<br>${lines.join("<br>")}`;
            }

            if (this.errorAdvice) {
                this.errorAdvice.innerHTML = `<ul>${allTips.map((t) => `<li class="${t.cls}">${t.text}</li>`).join("")}</ul>`;
            }

            this._openErrorModal();
        }

        exportCsv() {
            if (!this.replications || this.replications.length === 0) {
                this.output.renderStatsOut("Chưa có dữ liệu replication để xuất. Hãy bấm ‘Chạy nhiều lần’ trước.");
                return;
            }

            const header = ["rep", "seed", "avgWait", "avgQueueLength", "utilAvg", "throughput", "lambdaObs", "balked", "reneged", "waitP90"].join(",");
            const lines = this.replications.map((m, i) => {
                return [
                    i + 1,
                    m.seed === null || m.seed === undefined ? "" : String(m.seed),
                    fmt(m.avgWait, 6),
                    fmt(m.avgQueueLength, 6),
                    fmt(m.utilAvg, 6),
                    fmt(m.throughput, 6),
                    fmt(m.lambdaObs, 6),
                    Number(m.balked) || 0,
                    Number(m.reneged) || 0,
                    fmt(m.waitP90, 6),
                ].join(",");
            });

            const meta = this.lastReplicationMeta;
            const metaLine = meta ? `# reps=${meta.reps}, duration=${meta.duration}s, baseSeed=${meta.baseSeed}` : "";
            const csv = [metaLine, header, ...lines].filter(Boolean).join("\n");

            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "replications.csv";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        _openErrorModal() {
            if (!this.errorModal) return;
            this.errorModal.classList.add("show");
            this.errorModal.setAttribute("aria-hidden", "false");
        }

        _closeErrorModal() {
            if (!this.errorModal) return;
            this.errorModal.classList.remove("show");
            this.errorModal.setAttribute("aria-hidden", "true");
        }
    }

    window.app = new App();
})();
