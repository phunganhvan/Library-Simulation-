(function () {
    "use strict";

    /**
     * INPUT - Đầu vào: đọc form, nút bấm, thao tác người dùng
     */
    class InputController {
        constructor(app) {
            this.app = app;

            this.inputServers = document.getElementById("input-servers");
            this.inputArrival = document.getElementById("input-arrival");
            this.inputService = document.getElementById("input-service");
            this.inputPolicy = document.getElementById("input-policy");

            this.inputArrivalDist = document.getElementById("input-arrival-dist");
            this.inputServiceDist = document.getElementById("input-service-dist");
            this.inputPriorityEnabled = document.getElementById("input-priority-enabled");
            this.inputPriorityProb = document.getElementById("input-priority-prob");
            this.inputPriorityRule = document.getElementById("input-priority-rule");
            this.inputMaxQueue = document.getElementById("input-max-queue");
            this.inputPatience = document.getElementById("input-patience");

            this.inputErrors = document.getElementById("input-errors");

            this.btnPresetBalanced = document.getElementById("btn-preset-balanced");
            this.btnPresetRush = document.getElementById("btn-preset-rush");

            this.inputWinSeconds = document.getElementById("input-win-seconds");
            this.btnWindowStats = document.getElementById("btn-window-stats");

            this.inputSnapLabel = document.getElementById("input-snap-label");
            this.btnSnap = document.getElementById("btn-snap");
            this.chkSnapReset = document.getElementById("chk-snap-reset");

            this.btnToggleDashboard = document.getElementById("btn-toggle-dashboard");
            this.btnStatsBySnap = document.getElementById("btn-stats-by-snap");

            this.inputRepCount = document.getElementById("input-rep-count");
            this.btnRunRep = document.getElementById("btn-run-rep");
            this.btnErrorAnalysis = document.getElementById("btn-error-analysis");
            this.btnExportCsv = document.getElementById("btn-export-csv");

            this.btnStart = document.getElementById("btn-start");
            this.btnStop = document.getElementById("btn-stop");
            this.btnReset = document.getElementById("btn-reset");

            this.btnStart.addEventListener("click", () => this.app.start());
            this.btnStop.addEventListener("click", () => this.app.stop());
            this.btnReset.addEventListener("click", () => this.app.reset());

            this.btnPresetBalanced.addEventListener("click", () => this.app.applyPreset("balanced"));
            this.btnPresetRush.addEventListener("click", () => this.app.applyPreset("rush"));

            this.btnWindowStats.addEventListener("click", () => this.app.showWindowStats());
            this.btnSnap.addEventListener("click", () => this.app.addSnapshot());
            this.btnStatsBySnap.addEventListener("click", () => this.app.showStatsBySnapshot());
            this.btnToggleDashboard.addEventListener("click", () => this.app.toggleDashboard());

            this.btnRunRep.addEventListener("click", () => this.app.runReplications());
            this.btnErrorAnalysis.addEventListener("click", () => this.app.showErrorAnalysis());
            this.btnExportCsv.addEventListener("click", () => this.app.exportCsv());

            // đổi tham số sẽ reset để so sánh kịch bản rõ ràng
            [
                this.inputServers,
                this.inputArrival,
                this.inputService,
                this.inputPolicy,
                this.inputArrivalDist,
                this.inputServiceDist,
                this.inputPriorityEnabled,
                this.inputPriorityProb,
                this.inputPriorityRule,
                this.inputMaxQueue,
                this.inputPatience,
            ].forEach((el) => {
                el.addEventListener("change", () => this._handleConfigChanged());
            });

            [this.inputWinSeconds, this.inputRepCount].forEach((el) => {
                el.addEventListener("change", () => this._validateOnly());
            });

            this._validateOnly();
        }

        _handleConfigChanged() {
            this._validateOnly();
            this.app.reset();
        }

        _validateOnly() {
            const { errors } = this.getConfigWithValidation();
            this._renderErrors(errors);
            this.btnStart.disabled = errors.length > 0;
            this.btnRunRep.disabled = errors.length > 0;
            this.btnWindowStats.disabled = errors.length > 0;
            this.btnSnap.disabled = errors.length > 0;
            this.btnStatsBySnap.disabled = errors.length > 0;
            this.btnErrorAnalysis.disabled = errors.length > 0;
            this.btnExportCsv.disabled = errors.length > 0;
        }

        _renderErrors(errors) {
            if (!this.inputErrors) return;
            if (!errors || errors.length === 0) {
                this.inputErrors.textContent = "";
                return;
            }
            this.inputErrors.innerHTML = errors.map((e) => `• ${e}`).join("<br>");
        }

        getConfig() {
            return this.getConfigWithValidation().config;
        }

        getConfigWithValidation() {
            const errors = [];

            const servers = Number(this.inputServers.value);
            const meanInterArrivalSeconds = Number(this.inputArrival.value);
            const meanServiceSeconds = Number(this.inputService.value);
            const policy = this.inputPolicy.value;

            const arrivalDistribution = this.inputArrivalDist.value;
            const serviceDistribution = this.inputServiceDist.value;

            const priorityEnabled = this.inputPriorityEnabled.value === "on";
            const priorityProbability = Number(this.inputPriorityProb.value);
            const priorityRule = this.inputPriorityRule.value;

            const maxQueue = Number(this.inputMaxQueue.value);
            const patienceSeconds = Number(this.inputPatience.value);

            const winSeconds = Number(this.inputWinSeconds.value);
            const repCount = Number(this.inputRepCount.value);

            if (!Number.isFinite(servers) || servers < 1 || servers > 6) errors.push("Số quầy phải trong [1..6].");
            if (!Number.isFinite(meanInterArrivalSeconds) || meanInterArrivalSeconds <= 0) errors.push("Thời gian giữa 2 lượt đến (TB) phải > 0.");
            if (!Number.isFinite(meanServiceSeconds) || meanServiceSeconds <= 0) errors.push("Thời gian phục vụ TB phải > 0.");
            if (arrivalDistribution !== "exponential" && arrivalDistribution !== "bernoulli_tick") errors.push("Phân phối đến không hợp lệ.");
            if (!["uniform", "exponential", "deterministic"].includes(serviceDistribution)) errors.push("Phân phối phục vụ không hợp lệ.");

            if (priorityEnabled) {
                if (!Number.isFinite(priorityProbability) || priorityProbability < 0 || priorityProbability > 1) {
                    errors.push("Tỷ lệ SV ưu tiên phải trong [0..1].");
                }
                if (priorityRule !== "priority_then_fifo") errors.push("Quy tắc ưu tiên không hợp lệ.");
            }

            if (!Number.isFinite(maxQueue) || maxQueue < 0) errors.push("Giới hạn hàng chờ tối đa phải ≥ 0.");
            if (!Number.isFinite(patienceSeconds) || patienceSeconds < 0) errors.push("Ngưỡng bỏ hàng phải ≥ 0.");

            if (!Number.isFinite(winSeconds) || winSeconds < 5 || winSeconds > 600) errors.push("Khoảng thống kê phải trong [5..600] giây.");
            if (!Number.isFinite(repCount) || repCount < 5 || repCount > 200) errors.push("Số lần mô phỏng phải trong [5..200].");

            const config = {
                servers: Number.isFinite(servers) ? servers : 1,
                meanInterArrivalSeconds: Number.isFinite(meanInterArrivalSeconds) ? meanInterArrivalSeconds : 4,
                meanServiceSeconds: Number.isFinite(meanServiceSeconds) ? meanServiceSeconds : 20,
                policy,
                arrivalDistribution,
                serviceDistribution,
                priorityEnabled,
                priorityProbability: Number.isFinite(priorityProbability) ? priorityProbability : 0,
                priorityRule,
                maxQueue: Number.isFinite(maxQueue) ? maxQueue : 0,
                patienceSeconds: Number.isFinite(patienceSeconds) ? patienceSeconds : 0,
            };

            return { config, errors };
        }

        getWinSeconds() {
            const s = Number(this.inputWinSeconds.value);
            return Number.isFinite(s) ? s : 60;
        }

        getReplicationCount() {
            const n = Number(this.inputRepCount.value);
            return Number.isFinite(n) ? n : 30;
        }

        getSnapshotLabel() {
            const s = (this.inputSnapLabel && this.inputSnapLabel.value) ? this.inputSnapLabel.value.trim() : "";
            return s;
        }

        getSnapshotResetFlag() {
            return Boolean(this.chkSnapReset && this.chkSnapReset.checked);
        }
    }

    window.InputController = InputController;
})();
