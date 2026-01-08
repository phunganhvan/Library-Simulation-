// Mô phỏng hàng đợi nhiều quầy tại thư viện Tạ Quang Bửu
// - Cho phép cấu hình số quầy, tốc độ đến, tốc độ phục vụ
// - Đo: thời gian chờ trung bình, độ dài hàng đợi TB, mức sử dụng quầy

const queueArea = document.getElementById("queue-area");
const countersContainer = document.getElementById("counters-container");
const servedArea = document.getElementById("served-area");

const inputServers = document.getElementById("input-servers");
const inputArrival = document.getElementById("input-arrival");
const inputService = document.getElementById("input-service");

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReset = document.getElementById("btn-reset");

const statTotal = document.getElementById("stat-total");
const statQueue = document.getElementById("stat-queue");
const statServed = document.getElementById("stat-served");
const statCurrent = document.getElementById("stat-current");
const statSimTime = document.getElementById("stat-sim-time");
const statWaitAvg = document.getElementById("stat-wait-avg");
const statQueueAvg = document.getElementById("stat-queue-avg");
const statUtilAvg = document.getElementById("stat-util-avg");
const statLambda = document.getElementById("stat-lambda");
const statThroughput = document.getElementById("stat-throughput");
const statMu = document.getElementById("stat-mu");

const reportSection = document.getElementById("report-section");
const reportBody = document.getElementById("report-body");
const reportOverall = document.getElementById("report-overall");
const reportExplain = document.getElementById("report-explain");
const reportConclusion = document.getElementById("report-conclusion");

// Tham số mô phỏng
const TICK_SECONDS = 1; // mỗi bước mô phỏng tương đương 1 giây thực

let queue = [];
let servers = [];
let nextStudentId = 1;

let simTime = 0; // tổng thời gian mô phỏng (giây)
let totalArrived = 0;
let totalServed = 0;

let totalWaitTime = 0; // tổng thời gian chờ của các khách đã bắt đầu phục vụ
let waitCount = 0; // số khách đã được đưa vào quầy (đã có thời gian chờ xác định)

let queueLengthArea = 0; // tích phân độ dài hàng đợi theo thời gian để tính trung bình

let maxQueueLength = 0;

// lưu danh sách sinh viên vừa được phục vụ xong để hiển thị khu vực "ra về"
let recentServed = [];

let timerId = null;

function createServers() {
    const n = Math.max(1, Math.min(6, Number(inputServers.value) || 1));
    inputServers.value = String(n);

    servers = [];
    for (let i = 0; i < n; i++) {
        servers.push({
            id: i + 1,
            current: null, // khách đang được phục vụ
            remainingService: 0,
            totalBusyTime: 0,
            completed: 0,
        });
    }
}

function resetSimulation() {
    clearInterval(timerId);
    timerId = null;

    queue = [];
    nextStudentId = 1;
    simTime = 0;
    totalArrived = 0;
    totalServed = 0;
    totalWaitTime = 0;
    waitCount = 0;
    queueLengthArea = 0;
    maxQueueLength = 0;
    recentServed = [];

    createServers();
    render();

    // ẩn bảng báo cáo tới khi dừng mô phỏng
    reportSection.style.display = "none";
    reportBody.innerHTML = "";
    reportOverall.textContent = "";
    reportExplain.innerHTML = "";
    reportConclusion.textContent = "";
}

function randomServiceTime(meanSeconds) {
    const base = Math.max(1, meanSeconds);
    const min = base * 0.5;
    const max = base * 1.5;
    return min + Math.random() * (max - min);
}

function simulateStep() {
    const meanInterArrival = Math.max(1, Number(inputArrival.value) || 8); // giây
    const meanService = Math.max(1, Number(inputService.value) || 30); // giây

    simTime += TICK_SECONDS;
    // lưu tích phân độ dài hàng đợi
    queueLengthArea += queue.length * TICK_SECONDS;
    if (queue.length > maxQueueLength) maxQueueLength = queue.length;

    // Sinh khách mới (xấp xỉ tiến trình Poisson)
    const lambda = 1 / meanInterArrival; // khách / giây
    const probArrival = Math.min(0.95, lambda * TICK_SECONDS);
    if (Math.random() < probArrival) {
        const student = {
            id: nextStudentId++,
            arrivalTime: simTime,
        };
        queue.push(student);
        totalArrived += 1;
    }

    // Cập nhật từng quầy
    const justAssigned = [];
    const justFinished = [];

    servers.forEach((server) => {
        // nếu đang bận thì trừ thời gian còn lại
        if (server.current) {
            server.remainingService -= TICK_SECONDS;
            server.totalBusyTime += TICK_SECONDS;

            if (server.remainingService <= 0) {
                // hoàn thành phục vụ
                if (server.current) {
                    justFinished.push({ serverId: server.id, student: server.current });
                    recentServed.push({
                        id: server.current.id,
                        finishedAt: simTime,
                    });
                }

                server.current = null;
                server.remainingService = 0;
                server.completed += 1;
                totalServed += 1;
            }
        }

        // nếu quầy rảnh thì lấy khách trong hàng ra phục vụ
        if (!server.current && queue.length > 0) {
            const next = queue.shift();
            const wait = simTime - next.arrivalTime;
            totalWaitTime += wait;
            waitCount += 1;

            server.current = next;
            server.remainingService = randomServiceTime(meanService);
            justAssigned.push({ serverId: server.id, student: next });
        }
    });

    render(justAssigned, justFinished);
}

function render(justAssigned = [], justFinished = []) {
    // vẽ hàng đợi (tối đa 15 icon cho gọn)
    queueArea.innerHTML = "";
    const maxIcons = 15;
    const showCount = Math.min(maxIcons, queue.length);
    for (let i = 0; i < showCount; i++) {
        const el = document.createElement("div");
        el.className = "student waiting";
        el.title = `SV #${queue[i].id}`;
        queueArea.appendChild(el);
    }

    // vẽ danh sách sinh viên vừa được xử lý xong (ra về)
    const now = simTime;
    recentServed = recentServed.filter((c) => now - c.finishedAt < 8); // giữ tối đa 8 giây
    servedArea.innerHTML = "";
    recentServed.forEach((c) => {
        const el = document.createElement("div");
        el.className = "student served";
        el.title = `SV #${c.id} đã xử lý xong`;
        servedArea.appendChild(el);
    });

    // vẽ các quầy
    countersContainer.innerHTML = "";
    const assignedSet = new Set(justAssigned.map((e) => e.serverId));
    const finishedSet = new Set(justFinished.map((e) => e.serverId));

    servers.forEach((server) => {
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
        status.innerHTML = server.current
            ? `Đang phục vụ SV #${server.current.id}`
            : "Đang rảnh";

        card.appendChild(name);
        card.appendChild(icon);
        card.appendChild(status);
        countersContainer.appendChild(card);
    });

    // cập nhật thống kê
    const busyServers = servers.filter((s) => s.current).length;

    statTotal.textContent = String(totalArrived);
    statQueue.textContent = String(queue.length);
    statServed.textContent = String(totalServed);
    statCurrent.textContent = String(busyServers);
    statSimTime.textContent = String(simTime.toFixed(0));

    const avgWait = waitCount > 0 ? totalWaitTime / waitCount : 0;
    statWaitAvg.textContent = avgWait.toFixed(1);

    const avgQueueLength = simTime > 0 ? queueLengthArea / simTime : 0;
    statQueueAvg.textContent = avgQueueLength.toFixed(2);

    if (simTime > 0 && servers.length > 0) {
        const totalBusy = servers.reduce((sum, s) => sum + s.totalBusyTime, 0);
        const utilAvg = (totalBusy / (servers.length * simTime)) * 100;
        statUtilAvg.textContent = `${utilAvg.toFixed(1)}%`;
    } else {
        statUtilAvg.textContent = "0%";
    }

    // các thông số dòng chảy: tốc độ đến, thông lượng, tốc độ phục vụ TB
    if (simTime > 0) {
        const lambdaObs = totalArrived / simTime; // sinh viên/giây
        const throughput = totalServed / simTime; // sinh viên/giây
        const muPerServer = servers.length > 0 ? totalServed / (servers.length * simTime) : 0; // SV/giây/quầy

        statLambda.textContent = lambdaObs.toFixed(3);
        statThroughput.textContent = throughput.toFixed(3);
        statMu.textContent = muPerServer.toFixed(3);
    } else {
        statLambda.textContent = "0";
        statThroughput.textContent = "0";
        statMu.textContent = "0";
    }
}

function startSimulation() {
    if (timerId) return;
    createServers();
    timerId = setInterval(simulateStep, TICK_SECONDS * 1000);
}

function stopSimulation() {
    clearInterval(timerId);
    timerId = null;
    render();
    buildReport();
}

function buildReport() {
    if (simTime <= 0 || servers.length === 0) {
        reportSection.style.display = "none";
        return;
    }

    reportBody.innerHTML = "";

    const totalBusy = servers.reduce((sum, s) => sum + s.totalBusyTime, 0);
    const avgUtil = (totalBusy / (servers.length * simTime)) * 100;

    servers.forEach((s) => {
        const row = document.createElement("tr");
        const util = simTime > 0 ? (s.totalBusyTime / simTime) * 100 : 0;

        row.innerHTML = `
            <td>Quầy ${s.id}</td>
            <td>${s.completed}</td>
            <td>${s.totalBusyTime.toFixed(0)}</td>
            <td>${util.toFixed(1)}%</td>
        `;
        reportBody.appendChild(row);
    });

    const avgWait = waitCount > 0 ? totalWaitTime / waitCount : 0;
    const avgQueueLength = simTime > 0 ? queueLengthArea / simTime : 0;

    reportOverall.textContent =
        `Mô phỏng ${simTime.toFixed(0)} giây, tổng ${totalArrived} sinh viên đến, ` +
        `${totalServed} sinh viên được phục vụ xong.`;

    // mô tả chi tiết công thức
    reportExplain.innerHTML = `
        <p><strong>1. Thời gian chờ trung bình</strong><br>
        Gọi <code>W</code> là thời gian chờ trung bình, <code>waitCount</code> là số sinh viên đã được đưa vào quầy,<br>
        <code>totalWaitTime</code> là tổng thời gian chờ của các sinh viên đó (đơn vị giây).<br>
        Công thức: <code>W = totalWaitTime / waitCount</code><br>
        Với số liệu: <code>totalWaitTime = ${totalWaitTime.toFixed(1)}s</code>,
        <code>waitCount = ${waitCount}</code> ⇒ <code>W ≈ ${avgWait.toFixed(1)}s</code>.</p>

        <p><strong>2. Độ dài hàng đợi trung bình</strong><br>
        Tại mỗi bước thời gian <code>Δt = ${TICK_SECONDS}s</code> ta cộng độ dài hàng đợi hiện tại vào biến
        <code>queueLengthArea</code> (tích phân rời rạc). Gọi <code>L</code> là độ dài hàng đợi trung bình,<br>
        <code>T = simTime</code> là tổng thời gian mô phỏng.<br>
        Công thức: <code>L = queueLengthArea / T</code><br>
        Với số liệu: <code>queueLengthArea = ${queueLengthArea.toFixed(1)}</code>,
        <code>T = ${simTime.toFixed(0)}s</code> ⇒ <code>L ≈ ${avgQueueLength.toFixed(2)}</code>,
        độ dài lớn nhất quan sát được là <code>${maxQueueLength}</code> sinh viên.</p>

        <p><strong>3. Mức sử dụng quầy trung bình</strong><br>
        Với mỗi quầy <code>i</code>, ta tích lũy thời gian quầy bận vào <code>busyTime[i]</code> (ở đây là
        <code>server.totalBusyTime</code>). Gọi <code>ρ</code> là mức sử dụng trung bình toàn hệ thống,<br>
        <code>n</code> là số quầy, <code>T</code> là thời gian mô phỏng.<br>
        Công thức: <code>ρ = (∑ busyTime[i]) / (n · T)</code><br>
        Với số liệu: <code>∑busyTime[i] = ${totalBusy.toFixed(1)}s</code>,
        <code>n = ${servers.length}</code>, <code>T = ${simTime.toFixed(0)}s</code>
        ⇒ <code>ρ ≈ ${avgUtil.toFixed(1)}%</code>.</p>
    `;

    // 4. Kết luận cấu hình
    const lambdaObs = totalArrived / simTime; // SV/giây
    const throughput = totalServed / simTime; // SV/giây
    const muPerServer = servers.length > 0
        ? totalServed / (servers.length * simTime)
        : 0; // SV/giây/quầy

    const n = servers.length;
    const arrivalCfg = Number(inputArrival.value) || 0;
    const serviceCfg = Number(inputService.value) || 0;

    let conclusion;

    // Ngưỡng tham khảo
    const highWait = avgWait > 180 || avgQueueLength > 8 || avgUtil > 90; // >3 phút hoặc hàng >8, util >90%
    const veryLowWait = avgWait < 60 && avgQueueLength < 3 && avgUtil < 65;

    if (highWait) {
        const suggestServers = n + 1;
        conclusion =
            `Kết quả cho thấy cấu hình hiện tại có thời gian chờ tương đối lớn (≈ ${avgWait.toFixed(
                1,
            )}s, hàng TB ≈ ${avgQueueLength.toFixed(
                2,
            )} SV, ρ ≈ ${avgUtil.toFixed(
                1,
            )}%). ` +
            `Với tốc độ đến quan sát λ ≈ ${lambdaObs.toFixed(3)} SV/giây và năng lực phục vụ ` +
            `n·µ ≈ ${(n * muPerServer).toFixed(3)} SV/giây (n = ${n}), hệ thống đang khá tải. ` +
            `Nên cân nhắc tăng số quầy lên khoảng ${suggestServers} quầy hoặc rút ngắn thời gian phục vụ ` +
            `(ví dụ từ ~${serviceCfg}s xuống còn ~${Math.max(5, Math.round(serviceCfg * 0.7))}s) ` +
            `để giảm thời gian chờ và độ dài hàng đợi.`;
    } else if (veryLowWait) {
        const possibleServers = Math.max(1, n - 1);
        conclusion =
            `Thời gian chờ hiện rất thấp (≈ ${avgWait.toFixed(
                1,
            )}s, hàng TB ≈ ${avgQueueLength.toFixed(
                2,
            )} SV) trong khi mức sử dụng quầy chỉ khoảng ${avgUtil.toFixed(
                1,
            )}%. ` +
            `Có thể hệ thống đang dư quầy; bạn có thể thử giảm còn khoảng ${possibleServers} quầy ` +
            `hoặc tăng thời gian xử lý mỗi lượt một chút để tận dụng nhân lực tốt hơn mà thời gian chờ ` +
            `vẫn ở mức chấp nhận được.`;
    } else {
        conclusion =
            `Các chỉ số cho thấy cấu hình hiện tại khá cân bằng: thời gian chờ TB ≈ ${avgWait.toFixed(
                1,
            )}s, hàng đợi TB ≈ ${avgQueueLength.toFixed(
                2,
            )} SV, mức sử dụng quầy ≈ ${avgUtil.toFixed(
                1,
            )}%. ` +
            `Với λ ≈ ${lambdaObs.toFixed(3)} SV/giây và n·µ ≈ ${(n * muPerServer).toFixed(
                3,
            )} SV/giây, số quầy hiện tại (${n}) là hợp lý. ` +
            `Nếu muốn rút ngắn thời gian chờ hơn nữa, bạn có thể tăng thêm 1 quầy hoặc giảm nhẹ ` +
            `thời gian phục vụ trung bình cho mỗi sinh viên.`;
    }

    reportConclusion.textContent = conclusion;

    reportSection.style.display = "block";
}

btnStart.addEventListener("click", startSimulation);
btnStop.addEventListener("click", stopSimulation);
btnReset.addEventListener("click", resetSimulation);

// Khởi tạo ban đầu
resetSimulation();
