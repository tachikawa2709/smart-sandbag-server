const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
// เพิ่มบรรทัดนี้: เรียกใช้ multer สำหรับอัปโหลดไฟล์
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'rehab-secret',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

// ================= DATA FILES =================
const USERS_FILE = './data/users.json';
const RESULTS_FILE = './data/results.json';
const UPLOADS_DIR = './public/uploads'; // โฟลเดอร์สำหรับเก็บรูป

if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, '[]');

// สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const loadUsers = () => JSON.parse(fs.readFileSync(USERS_FILE));
const saveUsers = data => fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));

const loadResults = () => JSON.parse(fs.readFileSync(RESULTS_FILE));
const saveResults = data => fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));

// ================= FILE UPLOAD CONFIG =================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        // ตั้งชื่อไฟล์เป็น: user-timestamp.extension (ป้องกันชื่อซ้ำ)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // จำกัดขนาด 5MB
    fileFilter: (req, file, cb) => {
        // รับเฉพาะไฟล์รูปภาพ
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('รองรับเฉพาะไฟล์รูปภาพเท่านั้น'));
        }
    }
});

// ================= AUTH =================
app.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    const users = loadUsers();

    if (users.find(u => u.username === username)) {
        return res.json({ success: false, message: 'Username นี้มีแล้ว' });
    }

    if (users.find(u => u.email === email)) {
        return res.json({ success: false, message: 'Email นี้ถูกใช้งานแล้ว' });
    }

    const avatar = `https://ui-avatars.com/api/?name=${username}&background=random`;

    users.push({ username, email, password, avatar });
    saveUsers(users);
    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
});

app.post('/login', (req, res) => {
    const { login, password } = req.body;
    const users = loadUsers();

    const user = users.find(u =>
        (u.username === login || u.email === login) &&
        u.password === password
    );

    if (user) {
        req.session.user = user.username;
        res.json({ success: true });
    } else {
        res.json({ success: false, message: "ข้อมูลไม่ถูกต้อง" });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ================= USER API =================
app.get('/api/user', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }
    const users = loadUsers();
    const user = users.find(u => u.username === req.session.user);
    if (user) {
        res.json({
            username: user.username,
            email: user.email,
            avatar: user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=random`
        });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// API อัปโหลดรูปโปรไฟล์ (แบบไฟล์)
app.post('/api/user/avatar-upload', upload.single('avatar'), (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์รูปภาพ" });

    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username === req.session.user);

    if (userIndex !== -1) {
        // สร้าง URL สำหรับเรียกดูไฟล์ (เข้าถึงผ่าน /uploads/ชื่อไฟล์)
        const fileUrl = `/uploads/${req.file.filename}`;

        // ลบรูปเก่าทิ้งได้ถ้าต้องการ (ในที่นี้ขอข้ามไปก่อนเพื่อความง่าย)

        users[userIndex].avatar = fileUrl;
        saveUsers(users);

        res.json({ success: true, avatar: fileUrl });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// API อัปโหลดรูปโปรไฟล์ (แบบ URL เดิม - เผื่อไว้)
app.post('/api/user/avatar', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    const { avatarUrl } = req.body;

    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username === req.session.user);

    if (userIndex !== -1) {
        users[userIndex].avatar = avatarUrl;
        saveUsers(users);
        res.json({ success: true, avatar: avatarUrl });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// API ลืมรหัสผ่าน (Simulation)
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.email === email);

    if (user) {
        // ในระบบจริงจะส่ง Email แต่อันนี้เราจะจำลองโดยการตอบกลับรหัสผ่าน
        // (สำหรับการทดสอบใน Lab เท่านั้น)
        res.json({
            success: true,
            message: `ระบบตรวจสอบพบผู้ใช้! รหัสผ่านของคุณคือ: ${user.password}`
        });
    } else {
        res.status(404).json({ success: false, message: "ไม่พบอีเมลนี้ในระบบ" });
    }
});

// ================= API =================
app.post('/save', (req, res) => {
    if (!req.session.user) return res.status(401).end();

    const results = loadResults();
    results.push({
        user: req.session.user,
        time: req.body.time,
        rep: req.body.rep,
        date: new Date().toISOString()
    });
    saveResults(results);
    res.json({ success: true });
});

app.get('/results', (req, res) => {
    if (!req.session.user) return res.status(401).end();
    const results = loadResults().filter(r => r.user === req.session.user);
    res.json(results);
});

// ================= WEBSOCKET =================
let latestSensor = { angle: 0, rep: 0, running: false };

wss.on('connection', ws => {
    console.log('🔌 WS connected');
    ws.send(JSON.stringify({ type: 'sensor', payload: latestSensor }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'sensor') {
                latestSensor = data.payload;
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'sensor', payload: latestSensor }));
                    }
                });
            }
            if (data.type === 'control') {
                console.log("🎮 Ctrl:", data);
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (e) {
            console.error('WS Error:', e);
        }
    });

    ws.on('close', () => console.log('❎ WS disconnected'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});