(function () {
    "use strict";

    function drawLineChart(ctx, width, height, series, opts) {
        ctx.clearRect(0, 0, width, height);

        // background
        ctx.fillStyle = "#f9fbff";
        ctx.fillRect(0, 0, width, height);

        const padding = 28;
        const x0 = padding;
        const y0 = height - padding;
        const x1 = width - padding;
        const y1 = padding;

        // axes
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y1);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x1, y0);
        ctx.stroke();

        // labels
        ctx.fillStyle = "#334155";
        ctx.font = "12px Segoe UI, Arial";
        ctx.fillText(opts.yLabel || "", 6, 16);

        if (!series.length) {
            ctx.fillStyle = "#64748b";
            ctx.fillText("(chưa có dữ liệu)", x0 + 12, y1 + 20);
            return;
        }

        const maxY = Math.max(1e-6, ...series.map((p) => p.y));
        const minY = Math.min(0, ...series.map((p) => p.y));
        const range = Math.max(1e-6, maxY - minY);

        const maxX = series[series.length - 1].x;
        const minX = series[0].x;
        const xRange = Math.max(1e-6, maxX - minX);

        const toX = (x) => x0 + ((x - minX) / xRange) * (x1 - x0);
        const toY = (y) => y0 - ((y - minY) / range) * (y0 - y1);

        // grid lines
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        for (let i = 1; i <= 4; i++) {
            const yy = y0 - (i / 5) * (y0 - y1);
            ctx.beginPath();
            ctx.moveTo(x0, yy);
            ctx.lineTo(x1, yy);
            ctx.stroke();
        }

        // line
        ctx.strokeStyle = opts.color || "#2563eb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        series.forEach((p, idx) => {
            const xx = toX(p.x);
            const yy = toY(p.y);
            if (idx === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
        });
        ctx.stroke();

        // last value
        const last = series[series.length - 1];
        ctx.fillStyle = opts.color || "#2563eb";
        ctx.beginPath();
        ctx.arc(toX(last.x), toY(last.y), 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#0f172a";
        ctx.fillText(`${opts.valueLabel || ""}${last.y.toFixed(opts.decimals ?? 2)}`, x1 - 110, y1 + 16);
    }

    /**
     * OUTPUT - Dashboard biểu đồ thời gian thực
     */
    class Dashboard {
        constructor() {
            this.queueCanvas = document.getElementById("chart-queue");
            this.waitCanvas = document.getElementById("chart-wait");
            this.utilCanvas = document.getElementById("chart-util");

            this.queueCtx = this.queueCanvas.getContext("2d");
            this.waitCtx = this.waitCanvas.getContext("2d");
            this.utilCtx = this.utilCanvas.getContext("2d");

            this.windowSeconds = 300; // hiển thị ~5 phút gần nhất

            this.seriesQueue = [];
            this.seriesWait = [];
            this.seriesUtil = [];
        }

        reset() {
            this.seriesQueue = [];
            this.seriesWait = [];
            this.seriesUtil = [];
            this.render();
        }

        push(simTime, queueLen, avgWait, utilAvg) {
            this.seriesQueue.push({ x: simTime, y: queueLen });
            this.seriesWait.push({ x: simTime, y: avgWait });
            this.seriesUtil.push({ x: simTime, y: utilAvg });

            const minT = simTime - this.windowSeconds;
            this.seriesQueue = this.seriesQueue.filter((p) => p.x >= minT);
            this.seriesWait = this.seriesWait.filter((p) => p.x >= minT);
            this.seriesUtil = this.seriesUtil.filter((p) => p.x >= minT);

            this.render();
        }

        render() {
            drawLineChart(this.queueCtx, this.queueCanvas.width, this.queueCanvas.height, this.seriesQueue, {
                yLabel: "Hàng đợi",
                valueLabel: "L=",
                decimals: 0,
                color: "#2563eb",
            });

            drawLineChart(this.waitCtx, this.waitCanvas.width, this.waitCanvas.height, this.seriesWait, {
                yLabel: "Chờ (m)",
                valueLabel: "W=",
                decimals: 1,
                color: "#16a34a",
            });

            drawLineChart(this.utilCtx, this.utilCanvas.width, this.utilCanvas.height, this.seriesUtil, {
                yLabel: "Sử dụng (%)",
                valueLabel: "ρ=",
                decimals: 1,
                color: "#dc2626",
            });
        }
    }

    window.Dashboard = Dashboard;
})();
