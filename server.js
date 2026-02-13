require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const MongoStore = require('connect-mongo');

const app = express();
app.set('trust proxy', 1); // เชื่อมต่อผ่าน Proxy ของ Render (จำเป็นสำหรับ Secure Cookie)
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ================= DATABASE CONNECTION =================
console.log("⏳ Attempting to connect to MongoDB Atlas...");
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("✅ Successfully connected to MongoDB Atlas");
    })
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err.message);
    });

// ================= MODELS =================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatar: { type: String, default: '' }
});
const User = mongoose.model('User', UserSchema);

const ResultSchema = new mongoose.Schema({
    username: { type: String, required: true },
    rep: { type: Number, required: true },
    time: { type: Number, required: true }, // duration in seconds
    date: { type: Date, default: Date.now }
});
const Result = mongoose.model('Result', ResultSchema);

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'rehab-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true if on HTTPS
        maxAge: 1000 * 60 * 60 * 24 * 14 // 14 days
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ================= CLOUDINARY CONFIG =================
// ใช้ตัวแปรเดียว CLOUDINARY_URL เพื่อประหยัดพื้นที่จำกัดของ Render (ฟรี)
if (process.env.CLOUDINARY_URL) {
    cloudinary.config(process.env.CLOUDINARY_URL);
} else {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'rehab-avatars',
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 200, height: 200, crop: 'limit' }]
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // จำกัดขนาด 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('รองรับเฉพาะไฟล์รูปภาพเท่านั้น'));
        }
    }
});

// ================= AUTH =================
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.json({ success: false, message: 'Username หรือ Email นี้มีผู้ใช้งานแล้ว' });
        }

        const avatar = `https://ui-avatars.com/api/?name=${username}&background=random`;
        const newUser = new User({ username, email, password, avatar });
        await newUser.save();
        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงทะเบียน' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        const user = await User.findOne({
            $or: [{ username: login }, { email: login }],
            password: password
        });

        if (user) {
            req.session.userId = user._id; // เก็บแค่ ID
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "Username หรือ รหัสผ่านไม่ถูกต้อง" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ================= USER API =================
app.get('/api/user', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Not logged in" });
    }
    try {
        const user = await User.findById(req.session.userId);
        if (user) {
            res.json({
                username: user.username,
                email: user.email,
                avatar: user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=random`
            });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// API อัปโหลดรูปโปรไฟล์ (Cloudinary)
app.post('/api/user/avatar-upload', upload.single('avatar'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์รูปภาพ" });

    try {
        // req.file.path จะเป็น URL ของรูปบน Cloudinary โดยตรง
        const imageUrl = req.file.path;
        await User.findByIdAndUpdate(req.session.userId, { avatar: imageUrl });
        res.json({ success: true, avatar: imageUrl });
    } catch (err) {
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัปโหลด" });
    }
});

// API อัปโหลดรูปโปรไฟล์ (แบบ URL เดิม)
app.post('/api/user/avatar', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { avatarUrl } = req.body;

    try {
        await User.findByIdAndUpdate(req.session.userId, { avatar: avatarUrl });
        res.json({ success: true, avatar: avatarUrl });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// API ลืมรหัสผ่าน (MongoDB Simulation)
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user) {
            res.json({
                success: true,
                message: `ระบบตรวจสอบพบผู้ใช้! รหัสผ่านของคุณคือ: ${user.password}`
            });
        } else {
            res.status(404).json({ success: false, message: "ไม่พบอีเมลนี้ในระบบ" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// ================= API =================
app.post('/save', async (req, res) => {
    if (!req.session.userId) return res.status(401).end();

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).end();

        const newResult = new Result({
            username: user.username,
            time: req.body.time,
            rep: req.body.rep
        });
        await newResult.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/results', async (req, res) => {
    if (!req.session.userId) return res.status(401).end();
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).end();

        const results = await Result.find({ username: user.username }).sort({ date: 1 });
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
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