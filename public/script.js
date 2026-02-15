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


let isPaused = false;

// ---------- ปุ่ม Control ----------
function start() {
    ws.send(JSON.stringify({ type: "control", running: true, resume: isPaused }));

    // ถ้าไม่ได้เป็นการเล่นต่อ ให้เริ่มนับเวลาจาก 0
    if (!isPaused) {
        elapsedTime = 0;
    }

    // รีเซ็ตสถานะปุ่ม
    isPaused = false;
    updateStartButtonUI(false);

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
        elapsedTime++;
        updateUI();
    }, 1000);
}

function stop() {
    clearInterval(timer);
    ws.send(JSON.stringify({ type: "control", running: false, pause: true }));

    // เข้าสู่สถานะพัก และเปลี่ยนชื่อปุ่มเป็น "เล่นต่อ"
    isPaused = true;
    updateStartButtonUI(true);

    updateChart();
    processDeviceStatus("Paused");
}

function reset() {
    clearInterval(timer);
    elapsedTime = 0;
    angle = 0;
    rep = 0;
    calories = 0;
    isResetting = true;
    isPaused = false;

    // รีเซ็ตชื่อปุ่มกลับเป็น "เริ่ม"
    updateStartButtonUI(false);

    updateUI();
    processDeviceStatus("กำลังรีบูต...");
    ws.send(JSON.stringify({ type: "control", reset: true }));
}

function updateStartButtonUI(paused) {
    const btn = document.getElementById('startBtn');
    const icon = document.getElementById('startBtnIcon');
    const text = document.getElementById('startBtnText');

    if (!btn || !icon || !text) return;

    if (paused) {
        btn.classList.replace('bg-primary', 'bg-amber-500');
        btn.classList.replace('hover:bg-blue-600', 'hover:bg-amber-600');
        btn.classList.replace('shadow-primary/20', 'shadow-amber-500/20');
        icon.innerText = 'play_circle';
        text.innerText = 'เล่นต่อ';
    } else {
        btn.classList.add('bg-primary');
        btn.classList.remove('bg-amber-500');
        btn.classList.add('hover:bg-blue-600');
        btn.classList.remove('hover:bg-amber-600');
        btn.classList.add('shadow-primary/20');
        btn.classList.remove('shadow-amber-500/20');
        icon.innerText = 'play_arrow';
        text.innerText = 'เริ่ม';
    }
}

function saveResult() {
    fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: elapsedTime, rep: rep })
    })
        .then(res => {
            if (res.status === 401) {
                showToast("กรุณาเข้าสู่ระบบก่อนบันทึกผล", "warning");
                return null;
            }
            return res.json();
        })
        .then(result => {
            if (result) { // Check if result is not null (i.e., not 401)
                if (result.success) {
                    // Gamification Feedback
                    const xpGain = result.xpGained || 0;
                    let msg = `บันทึกเรียบร้อย! (+${xpGain} XP)`;

                    if (result.levelUp) {
                        showToast(`🎉 Level Up! ยินดีด้วยคุณขึ้นเลเวล ${result.newLevel}`, 'success');
                        // Force refresh levels
                        fetchAchievements();
                    }

                    if (result.newAchievements && result.newAchievements.length > 0) {
                        result.newAchievements.forEach(ach => {
                            showToast(`🏆 Achievement Unlocked: ${ach.name}`, 'warning'); // Use warning style for gold color if avail, or verify toast styles later
                        });
                    }

                    showToast(msg, 'success');

                    // Reset Frontend
                    // Assuming repCount refers to 'rep' and totalTime refers to 'elapsedTime'
                    rep = 0;
                    elapsedTime = 0;
                    calories = 0;
                    updateUI(); // Assuming updateDisplay() refers to updateUI()

                    // Refresh data
                    fetchAchievements();
                } else {
                    showToast("บันทึกไม่สำเร็จ: " + result.message, 'error');
                }
                updateChart(); // This should be called regardless of success or failure, but after processing the result.
            }
        });
}

// ---------- User Profile & File Upload ----------

// ---------- Profile Management Logic ----------
function showProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;

    // Fetch latest user data
    fetch('/api/user')
        .then(res => res.json())
        .then(user => {
            document.getElementById('profileModalAvatar').src = user.avatar;
            document.getElementById('profileUsername').value = user.username;
            document.getElementById('profileEmail').value = user.email;
            document.getElementById('profileAge').value = user.age || "";
            document.getElementById('profileGender').value = user.gender || "male";
            document.getElementById('profileWeight').value = user.weight || "";
            document.getElementById('profileHeight').value = user.height || "";
            document.getElementById('profileMedical').value = user.medicalConditions || "";
            document.getElementById('profilePassword').value = user.password || "";

            // Show modal
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                modal.querySelector('.transform').classList.remove('scale-95');
                modal.querySelector('.transform').classList.add('scale-100');
            }, 10);
        })
        .catch(err => {
            console.error("Error fetching user data:", err);
            showToast("ไม่สามารถดึงข้อมูลผู้ใช้ได้", "error");
        });
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;

    modal.classList.add('opacity-0');
    modal.querySelector('.transform').classList.replace('scale-100', 'scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function triggerProfileUpload() {
    document.getElementById('profileFileInput').click();
}

function previewProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Local preview for better UX
    const reader = new FileReader();
    reader.onload = function (e) {
        document.getElementById('profileModalAvatar').src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function toggleProfilePassword() {
    const passInput = document.getElementById('profilePassword');
    const passIcon = document.getElementById('profilePassIcon');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        passIcon.innerText = 'visibility';
    } else {
        passInput.type = 'password';
        passIcon.innerText = 'visibility_off';
    }
}

async function saveProfileChanges() {
    const btn = document.getElementById('saveProfileBtn');
    const originalContent = btn.innerHTML;

    // UI state: Loading
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons animate-spin">refresh</span> กำลังบันทึก...';

    try {
        const fileInput = document.getElementById('profileFileInput');
        const file = fileInput.files[0];

        // 1. If there's a new avatar, upload it first
        let currentAvatar = document.getElementById('profileModalAvatar').src;
        if (file) {
            const formData = new FormData();
            formData.append('avatar', file);
            const uploadRes = await fetch('/api/user/avatar-upload', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
                currentAvatar = uploadData.avatar;
            } else {
                throw new Error("อัปโหลดรูปไม่สำเร็จ: " + uploadData.message);
            }
        }

        // 2. Update profile information
        const payload = {
            username: document.getElementById('profileUsername').value,
            email: document.getElementById('profileEmail').value,
            age: document.getElementById('profileAge').value,
            gender: document.getElementById('profileGender').value,
            weight: document.getElementById('profileWeight').value,
            height: document.getElementById('profileHeight').value,
            medicalConditions: document.getElementById('profileMedical').value,
            password: document.getElementById('profilePassword').value
        };

        const res = await fetch('/api/user/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showToast("อัปเดตโปรไฟล์สำเร็จ!", "success");
            // Update Dashboard UI
            document.getElementById('userNameDisplay').innerText = payload.username;
            document.getElementById('userAvatarDisplay').src = currentAvatar;
            closeProfileModal();
        } else {
            showToast(data.message, "error");
        }

    } catch (err) {
        console.error(err);
        showToast(err.message || "เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
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
    showConfirmModal({
        title: "ออกจากระบบ?",
        message: "คุณต้องการออกจากระบบใช่หรือไม่? ข้อมูลที่ยังไม่ได้บันทึกอาจสูญหายได้",
        confirmText: "ออกจากระบบ",
        cancelText: "ยกเลิก",
        type: 'logout',
        onConfirm: () => {
            fetch('/logout', { method: 'POST' })
                .then(() => {
                    showToast("ออกจากระบบแล้ว", "success");
                    setTimeout(() => window.location.reload(), 1000);
                });
        }
    });
}

function updateLevelUI(level, xp) {
    // 1. Update Badge on Nav Icon
    const navBadge = document.getElementById('navLevelBadge');
    if (navBadge) {
        navBadge.innerText = level;
        navBadge.classList.remove('hidden');
    }

    // 2. Update Modal
    document.getElementById('modalLevel').innerText = level;
    document.getElementById('currentXp').innerText = `${xp} XP`;

    // Calc Progress: Level N starts at (N-1)^2 * 100 XP
    // XP for next level (N+1) is N^2 * 100
    // Example: Lvl 1 (0-100), Lvl 2 (100-400), Lvl 3 (400-900)

    const currentLevelBaseXp = Math.pow(level - 1, 2) * 100;
    const nextLevelBaseXp = Math.pow(level, 2) * 100;
    const range = nextLevelBaseXp - currentLevelBaseXp;
    const progress = xp - currentLevelBaseXp;

    const pct = Math.min(100, Math.max(0, (progress / range) * 100));

    document.getElementById('nextLevelXp').innerText = `${nextLevelBaseXp} XP`;
    document.getElementById('xpProgressBar').style.width = `${pct}%`;
}

function renderBadges(list) {
    const grid = document.getElementById('badgesGrid');
    grid.innerHTML = list.map(badge => {
        if (badge.unlocked) {
            return `
                <div class="aspect-square rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-yellow-500/30 flex flex-col items-center justify-center p-4 text-center group hover:bg-slate-800 transition-colors relative overflow-hidden">
                    <div class="absolute inset-0 bg-yellow-500/5 group-hover:bg-yellow-500/10 transition-colors"></div>
                    <span class="material-icons text-5xl text-yellow-400 mb-3 drop-shadow-lg">${badge.icon}</span>
                    <p class="text-white font-bold text-sm leading-tight mb-1">${badge.name}</p>
                    <p class="text-slate-500 text-[10px]">${badge.description}</p>
                </div>
            `;
        } else {
            return `
                <div class="aspect-square rounded-2xl bg-slate-800/30 border border-white/5 flex flex-col items-center justify-center p-4 text-center grayscale opacity-60">
                    <span class="material-icons text-4xl text-slate-600 mb-3">${badge.icon}</span>
                    <p class="text-slate-500 font-bold text-sm leading-tight mb-1">???</p>
                    <p class="text-slate-600 text-[10px]">Locked</p>
                </div>
            `;
        }
    }).join('');
}

function showAchievementsModal() {
    const modal = document.getElementById('achievementsModal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
        modal.querySelector('div').classList.add('scale-100');
    }, 10);
    fetchAchievements(); // Refresh on open
}

function closeAchievementsModal() {
    const modal = document.getElementById('achievementsModal');
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.remove('scale-100');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

// ---------- Chart Logic ----------

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

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check Login
    checkLoginStatus();

    // 2. Fetch Gamification Data
    fetchAchievements();

    // 3. Init Chart
    const ctx = document.getElementById('workoutChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
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

    // 4. Set Date Picker to Today & Load Chart
    const today = new Date().toLocaleDateString('en-CA');
    const dateInput = document.getElementById('datePicker');
    if (dateInput) {
        dateInput.value = today;
        updateChart();
    }

    // 5. Check Date Switch periodically
    setInterval(checkDateSwitch, 60000);
});

// ---------- UI Update Main ----------
function updateUI() {
    const timeEl = document.getElementById('timeDisplay');
    const angleEl = document.getElementById('angleDisplay');
    const repEl = document.getElementById('repDisplay');

    if (timeEl) timeEl.innerText = formatTime(elapsedTime);
    if (angleEl) angleEl.innerText = angle.toFixed(2) + "°";
    if (repEl) repEl.innerText = rep;

    calculateStats();
}
