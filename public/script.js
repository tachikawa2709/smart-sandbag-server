let running = false;
let elapsedTime = 0;
let timer = null;
let angle = 0;
let rep = 0;
let chart;
let isResetting = false;

// Metrics
let calories = 0;
let lastCheckedDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

// ---------- WebSocket ----------
// อัตโนมัติ: ถ้ารันบน Cloud จะใช้ wss:// (Secure) ถ้าแรันที่เครื่องจะใช้ ws://
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
    updateStatusBadge("Connected", "orange", false);
};

ws.onclose = () => {
    updateStatusBadge("Disconnected", "red", false);
    document.getElementById('pingDisplay').innerText = "Offline";
    document.getElementById('pingDisplay').style.color = "red";
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // 1. รับค่า STATUS
    if (data.type === 'status' && data.deviceStatus) {
        processDeviceStatus(data.deviceStatus);
    }

    // 2. รับค่า SENSOR
    if (data.type === 'sensor') {
        if (isResetting && data.payload.rep !== 0) return;
        if (data.payload.rep === 0) isResetting = false;

        angle = data.payload.angle;
        rep = data.payload.rep;

        if (data.payload.running !== undefined) running = data.payload.running;
        if (data.payload.deviceStatus) {
            processDeviceStatus(data.payload.deviceStatus);
        }

        updateUI();
    }
};

// ---------- Status Logic Helper ----------
function processDeviceStatus(statusText) {
    let displayText = statusText;
    let color = "gray";
    let pulse = false;

    if (statusText.includes("Ready") || statusText.includes("พร้อมใช้งาน")) {
        displayText = "Ready";
        color = "green";
        pulse = true;
    } else if (statusText.includes("Running") || statusText.includes("กำลังทำงาน")) {
        displayText = "Running";
        color = "blue";
        pulse = true;
    } else if (statusText.includes("Paused") || statusText.includes("หยุดชั่วคราว")) {
        displayText = "Paused";
        color = "yellow";
        pulse = false;
    } else if (statusText.includes("รีบูต") || statusText.includes("Reboot")) {
        displayText = "Rebooting...";
        color = "red";
        pulse = true;
    } else if (statusText.includes("รออุปกรณ์")) {
        displayText = "Waiting...";
        color = "orange";
        pulse = true;
    }

    updateStatusBadge(displayText, color, pulse);
}

function updateStatusBadge(text, color, pulse) {
    const badge = document.getElementById('statusBadge');
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusText');

    if (!badge || !dot || !label) return;

    badge.className = `flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors duration-300`;
    dot.className = `w-2 h-2 rounded-full`;

    if (color === "green") {
        badge.classList.add("bg-green-100", "text-green-600", "dark:bg-green-900/30", "dark:text-green-400");
        dot.classList.add("bg-green-500");
    } else if (color === "blue") {
        badge.classList.add("bg-blue-100", "text-blue-600", "dark:bg-blue-900/30", "dark:text-blue-400");
        dot.classList.add("bg-blue-500");
    } else if (color === "red") {
        badge.classList.add("bg-red-100", "text-red-900", "dark:bg-red-900/30", "dark:text-red-400");
        dot.classList.add("bg-red-500");
    } else if (color === "orange" || color === "yellow") {
        badge.classList.add("bg-yellow-100", "text-yellow-600", "dark:bg-yellow-900/30", "dark:text-yellow-400");
        dot.classList.add("bg-yellow-500");
    } else {
        badge.classList.add("bg-gray-100", "text-gray-600", "dark:bg-gray-800", "dark:text-gray-400");
        dot.classList.add("bg-gray-500");
    }

    if (pulse) dot.classList.add("animate-pulse");
    else dot.classList.remove("animate-pulse");

    label.innerText = text;
}


// ---------- โซนคำนวณ ----------
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function calculateStats() {
    calories = (rep * 0.5).toFixed(1);
    let rpm = 0;
    if (elapsedTime > 0) {
        rpm = (rep / (elapsedTime / 60)).toFixed(1);
    }

    document.getElementById('calDisplay').innerText = `${calories} kcal`;
    document.getElementById('rpmDisplay').innerText = `${rpm} RPM`;

    // เช็คการเปลี่ยนวันทุกครั้งที่มีการอัปเดต UI (หรือจะตั้ง Interval แยกก็ได้)
    checkDateSwitch();
}

// ระบบเช็คการเปลี่ยนวัน (ข้ามเที่ยงคืน)
function checkDateSwitch() {
    const today = new Date().toLocaleDateString('en-CA');
    if (today !== lastCheckedDate) {
        console.log("📅 Date changed! Updating current view to:", today);
        lastCheckedDate = today;
        const dateInput = document.getElementById('datePicker');
        if (dateInput) {
            dateInput.value = today;
            updateChart();
        }
    }
}


// ---------- ปุ่ม Control ----------
function start() {
    ws.send(JSON.stringify({ type: "control", running: true }));
    elapsedTime = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
        elapsedTime++;
        updateUI();
    }, 1000);
}

function stop() {
    clearInterval(timer);
    ws.send(JSON.stringify({ type: "control", running: false }));
    updateChart();
}

function reset() {
    stop();
    elapsedTime = 0;
    angle = 0;
    rep = 0;
    calories = 0;
    isResetting = true;
    updateUI();
    processDeviceStatus("กำลังรีบูต...");
    ws.send(JSON.stringify({ type: "control", reset: true }));
}

function saveResult() {
    fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: elapsedTime, rep: rep })
    })
        .then(res => {
            if (res.status === 401) {
                alert("กรุณาเข้าสู่ระบบก่อนบันทึกผล");
                return null;
            }
            return res.json();
        })
        .then(data => {
            if (data) {
                alert('บันทึกผลเรียบร้อย');
                updateChart();
            }
        });
}

// ---------- User Profile & File Upload ----------

function triggerFileUpload() {
    document.getElementById('fileAvatarInput').click();
}

function uploadAvatarFile() {
    const fileInput = document.getElementById('fileAvatarInput');
    const file = fileInput.files[0];

    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    fetch('/api/user/avatar-upload', {
        method: 'POST',
        body: formData
    })
        .then(res => {
            if (!res.ok) throw new Error("Upload Failed");
            return res.json();
        })
        .then(data => {
            if (data.success) {
                document.getElementById('userAvatarDisplay').src = data.avatar;
            } else {
                alert("อัปโหลดไม่สำเร็จ: " + data.message);
            }
        })
        .catch(err => {
            console.error(err);
            alert("เกิดข้อผิดพลาดในการอัปโหลด");
        });
}

function checkLoginStatus() {
    fetch('/api/user')
        .then(res => {
            if (res.ok) return res.json();
            throw new Error('Not logged in');
        })
        .then(user => {
            document.getElementById('userNameDisplay').innerText = user.username;
            document.getElementById('userAvatarDisplay').src = user.avatar;
            document.getElementById('loginWarning').classList.add('hidden');
        })
        .catch(() => {
            document.getElementById('userNameDisplay').innerText = "ผู้เยี่ยมชม";
            document.getElementById('userAvatarDisplay').src = "https://ui-avatars.com/api/?name=Guest&background=gray";
            document.getElementById('loginWarning').classList.remove('hidden');
        });
}

function logout() {
    if (confirm("ต้องการออกจากระบบใช่หรือไม่?")) {
        fetch('/logout', { method: 'POST' })
            .then(() => {
                alert("ออกจากระบบแล้ว");
                window.location.reload();
            });
    }
}

// ---------- Chart Logic ----------
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();

    const dateInput = document.getElementById('datePicker');
    const today = new Date().toLocaleDateString('en-CA');
    dateInput.value = today;
    lastCheckedDate = today;

    const ctx = document.getElementById('chart').getContext('2d');

    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.5)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Repetitions',
                data: [],
                backgroundColor: gradient,
                borderColor: '#3b82f6',
                borderWidth: 2,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#3b82f6',
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#f8fafc',
                    bodyColor: '#f8fafc',
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#e2e8f0', borderDash: [5, 5] },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                }
            }
        }
    });

    updateChart();

    // เช็คการเปลี่ยนวันทุก 1 นาที แม้ไม่ได้เทรน
    setInterval(checkDateSwitch, 60000);
});

function updateChart() {
    const dateInput = document.getElementById('datePicker');
    const selectedDate = dateInput.value;
    if (!selectedDate) return;

    fetch('/results')
        .then(res => {
            if (res.status === 401) return [];
            return res.json();
        })
        .then(list => {
            // แก้ไขจุดนี้: แปลง ISO string จาก Server เป็น Local Date ก่อนเทียบ
            const filteredList = list.filter(item => {
                const itemLocalDate = new Date(item.date).toLocaleDateString('en-CA');
                return itemLocalDate === selectedDate;
            });

            let maxRep = 0;
            if (filteredList.length > 0) {
                maxRep = Math.max(...filteredList.map(i => i.rep));
            }
            document.getElementById('maxRepDisplay').innerText = `${maxRep} ครั้ง`;

            const labels = [];
            const data = [];

            filteredList.forEach(item => {
                const timeLabel = new Date(item.date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                labels.push(timeLabel);
                data.push(item.rep);
            });

            chart.data.labels = labels;
            chart.data.datasets[0].data = data;
            chart.update();
        })
        .catch(err => console.error('Error loading chart:', err));
}

// ---------- UI Update Main ----------
function updateUI() {
    document.getElementById('timeDisplay').innerText = formatTime(elapsedTime);
    document.getElementById('angleDisplay').innerText = angle.toFixed(2) + "°";
    document.getElementById('repDisplay').innerText = rep;

    calculateStats();
}
