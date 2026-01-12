(function () {
    "use strict";

    /**
     * OUTPUT - Đầu ra: View + Dashboard số liệu
     * - Render hàng đợi, quầy, hiệu ứng vào/ra, khu vực sinh viên đã xử lý
     * - Render bảng report khi dừng
     */
    class OutputRenderer {
        constructor() {
            this.floor = document.querySelector(".floor");
            this.queueArea = document.getElementById("queue-area");
            this.countersContainer = document.getElementById("counters-container");
            this.servedArea = document.getElementById("served-area");

            this.studentsLayer = document.getElementById("students-layer");
            this.doorIn = document.getElementById("door-in");
            this.doorOut = document.getElementById("door-out");
            this.doorOutCount = document.getElementById("door-out-count");
            this.queueCountEl = document.getElementById("queue-count");

            this.STUDENT_SIZE = 56;
            this.MAX_QUEUE_ICONS = 15;

            // Movement tuning (visual speed)
            this.WALK_SPEED_PX_PER_SEC = 150; // lower = slower
            this.MIN_MOVE_MS = 450;
            this.MAX_MOVE_MS = 3200;
            this.ENTER_OFFSET_PX = 110;

            this.studentEls = new Map(); // id -> { el, status, timeouts: [], pos: {x,y,scale} }
            this.waitingIds = [];
            this.serverCooldownUntil = new Map(); // serverId -> performance.now() ms

            this.exitCount = 0;
            this._lastState = null;

            this.statTotal = document.getElementById("stat-total");
            this.statQueue = document.getElementById("stat-queue");
            this.statServed = document.getElementById("stat-served");
            this.statCurrent = document.getElementById("stat-current");
            this.statBalked = document.getElementById("stat-balked");
            this.statReneged = document.getElementById("stat-reneged");
            this.statSimTime = document.getElementById("stat-sim-time");
            this.statWaitAvg = document.getElementById("stat-wait-avg");
            this.statWaitP50 = document.getElementById("stat-wait-p50");
            this.statWaitP90 = document.getElementById("stat-wait-p90");
            this.statQueueAvg = document.getElementById("stat-queue-avg");
            this.statUtilAvg = document.getElementById("stat-util-avg");
            this.statLambda = document.getElementById("stat-lambda");
            this.statThroughput = document.getElementById("stat-throughput");
            this.statMu = document.getElementById("stat-mu");

            this.reportSection = document.getElementById("report-section");
            this.reportBody = document.getElementById("report-body");
            this.reportOverall = document.getElementById("report-overall");
            this.reportExplain = document.getElementById("report-explain");
            this.reportConclusion = document.getElementById("report-conclusion");

            this.statsOut = document.getElementById("stats-out");

            this.hideReport();

            // Create a spacer so the floor can scroll even though students are absolutely positioned.
            this.floorSpacer = document.getElementById("floor-spacer");
            if (!this.floorSpacer && this.floor) {
                this.floorSpacer = document.createElement("div");
                this.floorSpacer.id = "floor-spacer";
                this.floorSpacer.className = "floor-spacer";
                this.floor.appendChild(this.floorSpacer);
            }

            this._ensureQueueSlots(this.MAX_QUEUE_ICONS);
        }

        _ensureFloorScrollHeight(maxStudentY) {
            if (!this.floorSpacer) return;
            const base = 260;
            if (!Number.isFinite(maxStudentY)) {
                this.floorSpacer.style.height = `${base}px`;
                return;
            }
            const extra = 220; // space for doors / padding
            const h = Math.max(base, Math.ceil(maxStudentY + extra));
            this.floorSpacer.style.height = `${h}px`;
        }

        _resetExitCountIfNeeded(engineState) {
            if (!engineState) return;
            const isFresh = engineState.simTime === 0 && engineState.totalArrived === 0 && engineState.totalServed === 0;
            if (isFresh) {
                this.exitCount = 0;
                this._updateDoorOutCount();
            }
        }

        _updateDoorOutCount() {
            if (!this.doorOutCount) return;
            this.doorOutCount.textContent = String(this.exitCount);
        }

        _setQueueCount(value) {
            if (!this.queueCountEl) return;
            this.queueCountEl.textContent = `Đang chờ: ${value}`;
        }

        _setQueueCountPosition(x, y) {
            if (!this.queueCountEl) return;
            // Center the badge at (x,y)
            this.queueCountEl.style.left = `${x}px`;
            this.queueCountEl.style.top = `${y}px`;
            this.queueCountEl.style.transform = "translate(-50%, -50%)";
        }

        _ensureQueueSlots(n) {
            if (!this.queueArea) return;
            if (this.queueArea.dataset.slotsInit === "1") return;
            this.queueArea.innerHTML = "";
            for (let i = 0; i < n; i++) {
                const slot = document.createElement("div");
                slot.className = "queue-slot";
                this.queueArea.appendChild(slot);
            }
            this.queueArea.dataset.slotsInit = "1";
        }

        _floorRect() {
            if (!this.floor) return null;
            return this.floor.getBoundingClientRect();
        }

        _centerInFloor(el) {
            const fr = this._floorRect();
            if (!fr || !el) return { x: 0, y: 0 };
            const r = el.getBoundingClientRect();
            return {
                x: (r.left - fr.left) + r.width / 2,
                y: (r.top - fr.top) + r.height / 2,
            };
        }

        _setStudentTransform(el, x, y, scale) {
            const half = this.STUDENT_SIZE / 2;
            const tx = x - half;
            const ty = y - half;
            // Use translate for position, but preserve rotation from walk-tilt animation
            el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            el.style.transformOrigin = 'center bottom';
        }

        _dist(a, b) {
            const dx = (a.x - b.x);
            const dy = (a.y - b.y);
            return Math.sqrt(dx * dx + dy * dy);
        }

        _durationForMove(from, to) {
            const d = this._dist(from, to);
            const ms = (d / Math.max(1, this.WALK_SPEED_PX_PER_SEC)) * 1000;
            return Math.max(this.MIN_MOVE_MS, Math.min(this.MAX_MOVE_MS, ms));
        }

        _clearStudentTimeouts(rec) {
            if (!rec || !rec.timeouts) return;
            for (const t of rec.timeouts) clearTimeout(t);
            rec.timeouts.length = 0;
        }

        _moveStudent(id, x, y, scale, durationMs) {
            const rec = this.studentEls.get(id);
            if (!rec) return 0;

            const from = rec.pos || { x, y, scale: scale ?? 1 };
            const to = { x, y, scale: scale ?? 1 };
            const dur = Number.isFinite(durationMs) ? durationMs : this._durationForMove(from, to);

            // Add walking animation when moving
            if (dur > 100 && rec.status !== "serving") {
                rec.el.classList.add("walking");
                rec.el.classList.remove("waiting");
                if (rec.status === "waiting") rec.status = "walking";
            }

            rec.el.style.transitionTimingFunction = "linear";
            rec.el.style.transitionDuration = `${Math.max(50, dur)}ms`;
            this._setStudentTransform(rec.el, x, y, scale);
            rec.pos = { x, y, scale };

            return dur;
        }

        _syncWaitingFromState(engineState) {
            if (!engineState || !engineState.config) return;

            const policy = engineState.config.policy;
            const nextWaiting = [];

            if (policy === "multi_queue_shortest") {
                for (const s of engineState.servers || []) {
                    const ids = Array.isArray(s.queueIds) ? s.queueIds : [];
                    for (const id of ids) nextWaiting.push({ id, serverId: s.id });
                }
            } else {
                const ids = Array.isArray(engineState.singleQueueIds) ? engineState.singleQueueIds : [];
                for (const id of ids) nextWaiting.push({ id, serverId: null });
            }

            // Ensure all waiting students exist
            for (const item of nextWaiting) this._spawnStudentAtDoorIn(item.id);

            this.waitingModel = nextWaiting;
            this.waitingIds = nextWaiting.map((x) => x.id);
        }

        _removeStudent(id) {
            const rec = this.studentEls.get(id);
            if (!rec) return;
            this._clearStudentTimeouts(rec);
            rec.el.remove();
            this.studentEls.delete(id);
        }

        _spawnStudentAtDoorIn(id) {
            if (!this.studentsLayer) return;
            if (this.studentEls.has(id)) return;

            const el = document.createElement("div");
            // Appear at the entrance door, then walk to the waiting line.
            el.className = "student walking";
            el.title = `SV #${id}`;
            this.studentsLayer.appendChild(el);

            const pDoor = this._centerInFloor(this.doorIn);

            this._setStudentTransform(el, pDoor.x, pDoor.y, 1);

            const rec = { el, status: "walking", timeouts: [], pos: { x: pDoor.x, y: pDoor.y, scale: 1 } };
            this.studentEls.set(id, rec);
        }

        _queueSlotCenters() {
            const fr = this._floorRect();
            if (!fr || !this.queueArea) return [];
            const slots = Array.from(this.queueArea.querySelectorAll(".queue-slot"));
            return slots.map((s) => {
                const r = s.getBoundingClientRect();
                return {
                    x: (r.left - fr.left) + r.width / 2,
                    y: (r.top - fr.top) + r.height / 2,
                };
            });
        }

        _layoutQueue() {
            // Visual queue: layout depends on queue policy
            const state = this._lastState;
            const nServers = state && state.servers ? state.servers.length : 2;
            const policy = state && state.config && state.config.policy ? state.config.policy : "single_queue_fifo";
            
            const icons = [];
            for (let i = 1; i <= nServers; i++) {
                const el = this._counterIconEl(i);
                if (el) icons.push(this._centerInFloor(el));
            }

            let maxY = 0;

            // Fallback: if counter icons not ready yet, place students near counters container center
            if (icons.length === 0) {
                const p = this._centerInFloor(this.countersContainer);
                const startY = Math.max(30, p.y + 86);
                const rowGap = 64;
                for (let i = 0; i < this.waitingIds.length; i++) {
                    const id = this.waitingIds[i];
                    const rec = this.studentEls.get(id);
                    if (!rec) continue;
                    if (rec.status !== "waiting" && rec.status !== "walking") continue;
                    const dur = this._moveStudent(id, p.x, startY + i * rowGap, 1);
                    maxY = Math.max(maxY, startY + i * rowGap);
                    this._scheduleStopWalking(id, dur);
                }
                return maxY;
            }

            if (policy === "single_queue_fifo") {
                // Single FIFO queue: form one line in front of all counters
                const centerX = icons.reduce((sum, p) => sum + p.x, 0) / icons.length;
                const startY = Math.max(0, Math.max(...icons.map((p) => p.y)) + 86);
                const rowGap = 64;

                for (let i = 0; i < this.waitingIds.length; i++) {
                    const id = this.waitingIds[i];
                    const rec = this.studentEls.get(id);
                    if (!rec) continue;
                    if (rec.status !== "waiting" && rec.status !== "walking") continue;

                    const x = centerX;
                    const y = startY + i * rowGap;
                    const dur = this._moveStudent(id, x, y, 1);
                    maxY = Math.max(maxY, y);
                    // Stop walking when reached waiting position
                    this._scheduleStopWalking(id, dur);
                }
            } else {
                // Multi-queue: separate line per counter, using engine-provided queueIds
                const startY = Math.max(0, Math.max(...icons.map((p) => p.y)) + 86);
                const rowGap = 64;

                // waitingModel keeps (id, serverId)
                const model = Array.isArray(this.waitingModel) ? this.waitingModel : [];
                const byServer = new Map();
                for (const item of model) {
                    const sid = item.serverId;
                    if (!sid) continue;
                    if (!byServer.has(sid)) byServer.set(sid, []);
                    byServer.get(sid).push(item.id);
                }

                for (let sid = 1; sid <= nServers; sid++) {
                    const anchor = icons[Math.min(sid - 1, icons.length - 1)];
                    const ids = byServer.get(sid) || [];
                    for (let j = 0; j < ids.length; j++) {
                        const id = ids[j];
                        const rec = this.studentEls.get(id);
                        if (!rec) continue;
                        if (rec.status !== "waiting" && rec.status !== "walking") continue;
                        const x = anchor.x;
                        const y = startY + j * rowGap;
                        const dur = this._moveStudent(id, x, y, 1);
                        maxY = Math.max(maxY, y);
                        this._scheduleStopWalking(id, dur);
                    }
                }
            }

            return maxY;
        }

        _scheduleStopWalking(id, delayMs) {
            const rec = this.studentEls.get(id);
            if (!rec) return;
            const t = setTimeout(() => {
                // If the student is still in a waiting/walking phase, stop the walking loop.
                if (rec.status === "walking" || rec.status === "waiting") {
                    rec.status = "waiting";
                    rec.el.classList.remove("walking");
                    rec.el.classList.add("waiting");
                }
            }, delayMs + 100);
            rec.timeouts.push(t);
        }

        _counterIconEl(serverId) {
            return document.getElementById(`counter-icon-${serverId}`);
        }

        _animateAssigned(serverId, studentId, delayMs) {
            const rec = this.studentEls.get(studentId);
            if (!rec) return;
            this._clearStudentTimeouts(rec);
            rec.status = "toCounter";
            rec.el.classList.remove("waiting");
            rec.el.classList.add("walking");

            const run = () => {
                const icon = this._counterIconEl(serverId);
                const target = this._centerInFloor(icon);
                // approach
                const approach = { x: target.x, y: target.y + 12 };
                const approachMs = this._moveStudent(studentId, approach.x, approach.y, 1);
                // shrink into the desk (slower so it feels like walking into the counter)
                const t1 = setTimeout(() => {
                    rec.el.classList.remove("walking");
                    this._moveStudent(studentId, target.x, target.y + 6, 0.35, 650);
                    rec.status = "serving";
                }, approachMs + 60);
                rec.timeouts.push(t1);
            };

            const t0 = setTimeout(run, Math.max(0, delayMs || 0));
            rec.timeouts.push(t0);
        }

        _animateFinished(serverId, studentId) {
            const rec = this.studentEls.get(studentId);
            if (!rec) return;
            this._clearStudentTimeouts(rec);
            rec.status = "toExit";
            rec.el.classList.add("walking");

            if (!rec.exitCounted) {
                rec.exitCounted = true;
                this.exitCount += 1;
                this._updateDoorOutCount();
            }

            const icon = this._counterIconEl(serverId);
            const pDesk = icon ? this._centerInFloor(icon) : this._centerInFloor(this.doorIn);
            const pBehind = { x: pDesk.x, y: Math.max(20, pDesk.y - 70) };
            const pOut = this._centerInFloor(this.doorOut);

            // Step 1: move behind the counter ("walk around")
            const behindMs = this._moveStudent(studentId, pBehind.x, pBehind.y, 0.5);
            const outMs = this._durationForMove(pBehind, pOut);

            // Step 2: go to exit door
            const t1 = setTimeout(() => {
                this._moveStudent(studentId, pOut.x, pOut.y, 0.75);
            }, behindMs + 60);
            const t2 = setTimeout(() => {
                this._removeStudent(studentId);
            }, behindMs + outMs + 200);

            rec.timeouts.push(t1, t2);
        }

        hideReport() {
            this.reportSection.style.display = "none";
            this.reportBody.innerHTML = "";
            this.reportOverall.textContent = "";
            this.reportExplain.innerHTML = "";
            this.reportConclusion.textContent = "";
        }

        renderStatsOut(html) {
            if (!this.statsOut) return;
            this.statsOut.innerHTML = html || "";
        }

        render(engineState, metrics, events) {
            const { arrivals = [], justAssigned = [], justFinished = [], balked = [], reneged = [] } = events || {};

            this._lastState = engineState;
            this._resetExitCountIfNeeded(engineState);

            // Sync visual waiting list from engine state (FIFO / multi-queue)
            this._syncWaitingFromState(engineState);

            // Ensure queue slots exist even if DOM was reset
            this._ensureQueueSlots(this.MAX_QUEUE_ICONS);

            // Hàng đợi hiển thị: nếu multi-queue thì hiển thị tổng (gọn)
            const queueLen = engineState.config.policy === "multi_queue_shortest"
                ? engineState.servers.reduce((sum, s) => sum + s.queueLength, 0)
                : engineState.singleQueueLength;

            this._setQueueCount(queueLen);

            // Spawn students on arrival (at door-in) and add to local waiting list
            for (const c of arrivals) {
                this._spawnStudentAtDoorIn(c.id);
                // waitingIds is derived from engine state now
            }

            // Remove balked students immediately (they never enter the system)
            for (const c of balked) {
                // not spawned by default (only enqueued arrivals are spawned)
                // but keep safe if future logic changes
                this._removeStudent(c.id);
                const idx = this.waitingIds.indexOf(c.id);
                if (idx >= 0) this.waitingIds.splice(idx, 1);
            }

            // Remove reneged students (they leave the queue)
            for (const c of reneged) {
                this._animateFinished(0, c.id); // fallback path to door-out
                const idx = this.waitingIds.indexOf(c.id);
                if (idx >= 0) this.waitingIds.splice(idx, 1);
            }

            // Sinh viên vừa xử lý xong
            this.servedArea.innerHTML = "";
            for (const c of engineState.recentServed) {
                const el = document.createElement("div");
                el.className = "student served";
                el.title = `SV #${c.id} đã xử lý xong`;
                this.servedArea.appendChild(el);
            }

            // Quầy
            this.countersContainer.innerHTML = "";
            const assignedSet = new Set(justAssigned.map((e) => e.serverId));
            const finishedSet = new Set(justFinished.map((e) => e.serverId));

            const nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            for (const e of justFinished) {
                // allow a short visible "free" state before next student goes in
                this.serverCooldownUntil.set(e.serverId, nowMs + 750);
            }

            for (const server of engineState.servers) {
                const card = document.createElement("div");
                card.className = "counter-card";

                const name = document.createElement("div");
                name.className = "counter-name";
                name.textContent = `Quầy ${server.id}`;

                const icon = document.createElement("div");
                icon.id = `counter-icon-${server.id}`;

                const cooldownUntil = this.serverCooldownUntil.get(server.id) || 0;
                const inCooldown = nowMs < cooldownUntil;

                // Visual priority: just finished => show free for a moment
                const visualBusy = Boolean(server.current) && !inCooldown;
                let iconClass = "counter-icon " + (visualBusy ? "busy" : "free");
                if (assignedSet.has(server.id)) iconClass += " entering";
                if (finishedSet.has(server.id)) iconClass += " leaving";
                icon.className = iconClass;

                const status = document.createElement("div");
                status.className = "counter-status";
                if (inCooldown) {
                    status.textContent = "Đang trả quầy...";
                } else if (server.current) {
                    status.textContent = `Đang phục vụ SV #${server.current.id}`;
                } else {
                    const extra = engineState.config.policy === "multi_queue_shortest"
                        ? ` (hàng: ${server.queueLength})`
                        : "";
                    status.textContent = "Đang rảnh" + extra;
                }

                card.appendChild(name);
                card.appendChild(icon);
                card.appendChild(status);
                this.countersContainer.appendChild(card);
            }

            // Handle assignments and finishes with animation
            for (const e of justAssigned) {
                const id = e.student && e.student.id;
                if (!id) continue;
                // ensure exists
                this._spawnStudentAtDoorIn(id);

                // remove from waiting list (priority/multi-queue safe)
                const idx = this.waitingIds.indexOf(id);
                if (idx >= 0) this.waitingIds.splice(idx, 1);

                const cooldownUntil = this.serverCooldownUntil.get(e.serverId) || 0;
                const delay = Math.max(0, cooldownUntil - nowMs);
                this._animateAssigned(e.serverId, id, delay);
            }

            for (const e of justFinished) {
                const id = e.student && e.student.id;
                if (!id) continue;
                this._animateFinished(e.serverId, id);
            }

            // Layout waiting students (smoothly move forward)
            const maxY = this._layoutQueue();
            this._ensureFloorScrollHeight(maxY);

            // Position queue counter badge near the waiting line (between the two counters if possible)
            try {
                const nServers = engineState && engineState.servers ? engineState.servers.length : 2;
                const cols = Math.max(1, Math.min(2, nServers));
                const icons = [];
                for (let i = 1; i <= cols; i++) {
                    const el = this._counterIconEl(i);
                    if (el) icons.push(this._centerInFloor(el));
                }

                if (icons.length > 0) {
                    const x = icons.length === 1 ? icons[0].x : (icons[0].x + icons[1].x) / 2;
                    const y = Math.max(...icons.map((p) => p.y)) + 52;
                    this._setQueueCountPosition(x, y);
                } else {
                    // fallback: use queue-area center
                    const p = this._centerInFloor(this.queueArea);
                    this._setQueueCountPosition(p.x, p.y - 18);
                }
            } catch (_) {
                // ignore positioning errors
            }

            // Stats
            const busyServers = engineState.servers.filter((s) => s.current).length;

            this.statTotal.textContent = String(engineState.totalArrived);
            this.statQueue.textContent = String(queueLen);
            this.statServed.textContent = String(engineState.totalServed);
            this.statCurrent.textContent = String(busyServers);

            if (this.statBalked) this.statBalked.textContent = String(metrics.balked || 0);
            if (this.statReneged) this.statReneged.textContent = String(metrics.reneged || 0);
            this.statSimTime.textContent = String(engineState.simTime.toFixed(0));

            this.statWaitAvg.textContent = metrics.avgWait.toFixed(1);
            if (this.statWaitP50) this.statWaitP50.textContent = (metrics.waitP50 || 0).toFixed(1);
            if (this.statWaitP90) this.statWaitP90.textContent = (metrics.waitP90 || 0).toFixed(1);
            this.statQueueAvg.textContent = metrics.avgQueueLength.toFixed(2);
            this.statUtilAvg.textContent = `${metrics.utilAvg.toFixed(1)}%`;

            this.statLambda.textContent = metrics.lambdaObs.toFixed(3);
            this.statThroughput.textContent = metrics.throughput.toFixed(3);
            this.statMu.textContent = metrics.muPerServer.toFixed(3);
        }

        renderReport(engine, engineState, metrics) {
            if (!engineState || engineState.simTime <= 0) {
                this.hideReport();
                return;
            }

            this.reportBody.innerHTML = "";
            for (const s of engineState.servers) {
                const row = document.createElement("tr");
                const util = engineState.simTime > 0 ? (s.totalBusyTime / engineState.simTime) * 100 : 0;
                row.innerHTML = `
                    <td>Quầy ${s.id}</td>
                    <td>${s.completed}</td>
                    <td>${s.totalBusyTime.toFixed(0)}</td>
                    <td>${util.toFixed(1)}%</td>
                `;
                this.reportBody.appendChild(row);
            }

            this.reportOverall.textContent =
                `Mô phỏng ${engineState.simTime.toFixed(0)} phút, tổng ${engineState.totalArrived} sinh viên đến, ` +
                `${engineState.totalServed} sinh viên được phục vụ xong.`;

            this.reportExplain.innerHTML = engine.buildExplainHtml();
            this.reportConclusion.textContent = engine.buildConclusion();
            this.reportSection.style.display = "block";
        }
    }

    window.OutputRenderer = OutputRenderer;
})();
