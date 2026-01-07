(function () {
    "use strict";

    /**
     * OUTPUT - Đầu ra: View + Dashboard số liệu
     * - Render hàng đợi, quầy, hiệu ứng vào/ra, khu vực sinh viên đã xử lý
     * - Render bảng report khi dừng
     */
    class OutputRenderer {
        constructor() {
            this.queueArea = document.getElementById("queue-area");
            this.countersContainer = document.getElementById("counters-container");
            this.servedArea = document.getElementById("served-area");

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
            const { justAssigned = [], justFinished = [] } = events || {};

            // Hàng đợi hiển thị: nếu multi-queue thì hiển thị tổng (gọn)
            const queueLen = engineState.config.policy === "multi_queue_shortest"
                ? engineState.servers.reduce((sum, s) => sum + s.queueLength, 0)
                : engineState.singleQueueLength;

            this.queueArea.innerHTML = "";
            const maxIcons = 15;
            const showCount = Math.min(maxIcons, queueLen);
            for (let i = 0; i < showCount; i++) {
                const el = document.createElement("div");
                el.className = "customer waiting";
                el.title = "Sinh viên đang chờ";
                this.queueArea.appendChild(el);
            }

            // Sinh viên vừa xử lý xong
            this.servedArea.innerHTML = "";
            for (const c of engineState.recentServed) {
                const el = document.createElement("div");
                el.className = "customer served";
                el.title = `SV #${c.id} đã xử lý xong`;
                this.servedArea.appendChild(el);
            }

            // Quầy
            this.countersContainer.innerHTML = "";
            const assignedSet = new Set(justAssigned.map((e) => e.serverId));
            const finishedSet = new Set(justFinished.map((e) => e.serverId));

            for (const server of engineState.servers) {
                const card = document.createElement("div");
                card.className = "counter-card";

                const name = document.createElement("div");
                name.className = "counter-name";
                name.textContent = `Quầy ${server.id}`;

                const icon = document.createElement("div");
                let iconClass = "counter-icon " + (server.current ? "busy" : "free");
                if (assignedSet.has(server.id)) iconClass += " entering";
                if (finishedSet.has(server.id)) iconClass += " leaving";
                icon.className = iconClass;

                const status = document.createElement("div");
                status.className = "counter-status";
                if (server.current) {
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
                `Mô phỏng ${engineState.simTime.toFixed(0)} giây, tổng ${engineState.totalArrived} sinh viên đến, ` +
                `${engineState.totalServed} sinh viên được phục vụ xong.`;

            this.reportExplain.innerHTML = engine.buildExplainHtml();
            this.reportConclusion.textContent = engine.buildConclusion();
            this.reportSection.style.display = "block";
        }
    }

    window.OutputRenderer = OutputRenderer;
})();
