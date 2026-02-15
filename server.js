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
    avatar: { type: String, default: '' },
    age: { type: Number, default: 0 },
    gender: { type: String, default: '' },
    weight: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    medicalConditions: { type: String, default: '' }
});
const User = mongoose.model('User', UserSchema);

const ResultSchema = new mongoose.Schema({
    username: { type: String, required: true },
    rep: { type: Number, required: true },
    time: { type: Number, required: true }, // duration in seconds
    date: { type: Date, default: Date.now }
});
const Result = mongoose.model('Result', ResultSchema);

const AssessmentSchema = new mongoose.Schema({
    username: { type: String, required: true },
    type: { type: String, enum: ['pre', 'post'], required: true },
    painLevel: { type: Number }, // Optional for post-assessment
    ratings: { type: Map, of: Number }, // For multi-question ratings
    fatigue: { type: String }, // 'yes'/'no' or 'low'/'med'/'high'
    comment: { type: String },
    date: { type: Date, default: Date.now }
});
const Assessment = mongoose.model('Assessment', AssessmentSchema);

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
        ttl: 30 * 24 * 60 * 60 // 30 days
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true if on HTTPS
        maxAge: 1000 * 60 * 60 * 24 * 1 // Default 1 day (or session-only if maxAge is not set, but here we set a base)
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
        console.log("📂 File filter checking file:", file.originalname, "Mimetype:", file.mimetype);
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('รองรับเฉพาะไฟล์รูปภาพเท่านั้น'), false);
        }
    }
});

// ================= AUTH =================
app.post('/register', async (req, res) => {
    try {
        const { username, email, password, age, gender, weight, height, medicalConditions } = req.body;
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.json({ success: false, message: 'Username หรือ Email นี้มีผู้ใช้งานแล้ว' });
        }

        const avatar = `https://ui-avatars.com/api/?name=${username}&background=random`;
        const newUser = new User({
            username,
            email,
            password,
            avatar,
            age: parseInt(age) || 0,
            gender: gender || '',
            weight: parseFloat(weight) || 0,
            height: parseFloat(height) || 0,
            medicalConditions: medicalConditions || ''
        });
        await newUser.save();
        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
    } catch (err) {
        console.error("❌ Register Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงทะเบียน' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { login, password, rememberMe } = req.body;
        const user = await User.findOne({
            $or: [{ username: login }, { email: login }],
            password: password
        });

        if (user) {
            req.session.userId = user._id;
            req.session.username = user.username;

            // ถ้าเลือก Remember Me ให้ขยายเวลา Cookie เป็น 30 วัน
            if (rememberMe) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
            } else {
                req.session.cookie.expires = false; // Session-only (หายเมื่อปิดเบราว์เซอร์)
            }

            res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ' });
        } else {
            res.json({ success: false, message: 'Username หรือ รหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) {
        console.error("❌ Login Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
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
                avatar: user.avatar || `https://ui-avatars.com/api/?name=${user.username}&background=random`,
                age: user.age || 0,
                gender: user.gender || '',
                weight: user.weight || 0,
                height: user.height || 0,
                medicalConditions: user.medicalConditions || '',
                password: user.password
            });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (err) {
        console.error("❌ API Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" });
    }
});

// API อัปเดตข้อมูลโปรไฟล์ทั้งหมด
app.post('/api/user/update-profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });

    try {
        const { username, email, password, age, gender, medicalConditions } = req.body;

        // เช็ค username/email ซ้ำ (ยกเว้นของตัวเอง)
        const duplicate = await User.findOne({
            $and: [
                { _id: { $ne: req.session.userId } },
                { $or: [{ username }, { email }] }
            ]
        });

        if (duplicate) {
            return res.json({ success: false, message: 'Username หรือ Email นี้มีผู้ใช้คนอื่นใช้งานแล้ว' });
        }

        await User.findByIdAndUpdate(req.session.userId, {
            username,
            email,
            password,
            age: parseInt(age) || 0,
            gender,
            medicalConditions
        });

        res.json({ success: true, message: "อัปเดตโปรไฟล์สำเร็จ" });
    } catch (err) {
        console.error("❌ Update Profile Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
    }
});

// API อัปโหลดรูปโปรไฟล์ (Cloudinary)
app.post('/api/user/avatar-upload', (req, res, next) => {
    upload.single('avatar')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error("❌ Multer Error:", err.code, err.message);
            return res.status(400).json({ success: false, message: `Multer error: ${err.message}` });
        } else if (err) {
            console.error("❌ Upload Error:", err.message);
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    if (!req.file) {
        console.log("⚠️ No file in request. req.body:", JSON.stringify(req.body));
        return res.status(400).json({ error: "กรุณาเลือกไฟล์รูปภาพ" });
    }

    try {
        console.log("📸 Received avatar upload request for user:", req.session.userId);
        console.log("📄 File info:", JSON.stringify(req.file, null, 2));

        const imageUrl = req.file.path;
        console.log("✅ Image uploaded to Cloudinary:", imageUrl);

        await User.findByIdAndUpdate(req.session.userId, { avatar: imageUrl });
        console.log("💾 Database updated with new avatar URL");

        res.json({ success: true, avatar: imageUrl });
    } catch (err) {
        console.error("❌ Avatar Content Error:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการอัปโหลด: " + err.message });
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
        console.error("❌ Avatar Update Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตรูปภาพ" });
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
        console.error("❌ Forgot Password Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการตรวจสอบอีเมล" });
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
        console.error("❌ Save Result Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกผล" });
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
        console.error("❌ Results Fetch Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงประวัติ" });
    }
});

app.post('/api/assessment', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "กรุณาเข้าสู่ระบบก่อนทำแบบประเมิน" });

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ success: false, message: "ไม่พบข้อมูลผู้ใช้" });

        const { type, painLevel, fatigue, comment, ratings } = req.body;

        const newAssessment = new Assessment({
            username: user.username,
            type,
            painLevel,
            fatigue,
            comment,
            ratings
        });

        await newAssessment.save();
        res.json({ success: true, message: "บันทึกข้อมูลแบบประเมินเรียบร้อยแล้ว" });
    } catch (err) {
        console.error("❌ Assessment Save Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกแบบประเมิน" });
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