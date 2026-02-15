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
    medicalConditions: { type: String, default: '' },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    // Gamification
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    achievements: { type: [String], default: [] }, // IDs of unlocked achievements
    streak: { type: Number, default: 0 },
    lastActiveDate: { type: Date },
    bestSessionRep: { type: Number, default: 0 }
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
// ================= EMAIL CONFIG =================
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // App Password (16 characters)
    }
});

// ================= AUTH (Forgot Password) =================
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: "ไม่พบอีเมลนี้ในระบบ" });
        }

        // Generate Token
        const token = crypto.randomBytes(20).toString('hex');

        // Update User with Token & Expiration (1 Hour)
        // Note: You need to add these fields to UserSchema if not using strict: false
        // For simplicity with Mongoose, we can use findByIdAndUpdate with strict: false logic or add fields to schema.
        // Let's assume we add them to schema or just save them.
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save(); // This might fail if 'resetPasswordToken' is not in Schema. We'll fix Schema next.

        const resetUrl = `http://${req.headers.host}/reset-password.html?token=${token}`;

        const mailOptions = {
            from: `"StrongEase Support" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: '🔒 Reset Your Password - StrongEase',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #f8fafc;">
                    <h2 style="color: #0f172a; text-align: center;">Reset Your Password</h2>
                    <p style="color: #475569; font-size: 16px;">คุณได้รับอีเมลนี้เนื่องจากมีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">ตั้งรหัสผ่านใหม่</a>
                    </div>
                    <p style="color: #475569; font-size: 14px;">หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลเรียบร้อยแล้ว' });

    } catch (err) {
        console.error("❌ Forgot Password Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการส่งอีเมล" });
    }
});

app.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ' });
        }

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบใหม่' });
    } catch (err) {
        console.error("❌ Reset Password Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน" });
    }
});

// ================= API =================
// ================= GAMIFICATION CONSTANTS =================
const ACHIEVEMENTS_LIST = [
    // Tiers
    { id: 'tier_beginner', name: 'มือใหม่สายดึง', description: 'Beginner Tier: 15 Reps/Session, 3 Days Streak, 100 Total Reps', icon: 'military_tech', color: 'text-orange-400' }, // Bronze
    { id: 'tier_intermediate', name: 'นักฝึกสายอึด', description: 'Intermediate Tier: 30 Reps/Session, 3 Sets/Day, 500 Total Reps', icon: 'military_tech', color: 'text-slate-400' }, // Silver
    { id: 'tier_advanced', name: 'Resistance Master', description: 'Advanced Tier: 50 Reps/Session, 7 Days Streak, 1000 Total Reps', icon: 'military_tech', color: 'text-yellow-400' }, // Gold

    // Daily & Streak
    { id: 'iron_streak', name: 'Iron Streak', description: 'ออกกำลังกายต่อเนื่อง 5 วัน', icon: 'local_fire_department', color: 'text-orange-500' },
    { id: 'consistency_hero', name: 'Consistency Hero', description: 'ออกกำลังกายต่อเนื่อง 30 วัน', icon: 'verified', color: 'text-blue-500' },
    { id: 'daily_grind', name: 'Daily Grid', description: 'ทำครบ 20 Reps ในวันเดียว', icon: 'today', color: 'text-green-500' },

    // Misc
    { id: 'first_blood', name: 'ก้าวแรกสู่สังเวียน', description: 'บันทึกการฝึกครั้งแรก', icon: 'emoji_events', color: 'text-yellow-500' },
    { id: 'century_club', name: 'นักยก 100 ครั้ง', description: 'ยกครบ 100 ครั้งรวม', icon: 'fitness_center', color: 'text-blue-400' }
];

app.post('/save', async (req, res) => {
    if (!req.session.userId) return res.status(401).end();

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).end();

        const currentRep = req.body.rep;
        const currentTime = req.body.time;

        // 1. Save Result
        const newResult = new Result({
            username: user.username,
            time: currentTime,
            rep: currentRep
        });
        await newResult.save();

        // 2. Gamification: Stats Update
        const xpGained = currentRep * 10;
        user.xp = (user.xp || 0) + xpGained;

        // Level Calc
        const oldLevel = user.level || 1;
        const newLevel = Math.floor(Math.sqrt(user.xp / 100)) + 1;
        let levelUp = false;
        if (newLevel > oldLevel) {
            user.level = newLevel;
            levelUp = true;
        }

        // Streak Logic
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;

        let streak = user.streak || 0;

        if (lastActive) {
            const lastActiveStart = new Date(lastActive.getFullYear(), lastActive.getMonth(), lastActive.getDate());
            const diffTime = todayStart - lastActiveStart;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                // Consecutive day
                streak++;
            } else if (diffDays > 1) {
                // Break in streak
                streak = 1;
            }
            // If diffDays === 0 (Same day), keep streak
        } else {
            streak = 1;
        }
        user.streak = streak;
        user.lastActiveDate = now;

        // Best Session Rep
        if (currentRep > (user.bestSessionRep || 0)) {
            user.bestSessionRep = currentRep;
        }

        // 3. Check Achievements
        const unlockedIds = [];

        // Fetch Aggregated Stats
        const allResults = await Result.find({ username: user.username });
        const totalReps = allResults.reduce((sum, r) => sum + r.rep, 0);

        // Daily Stats
        const todayResults = allResults.filter(r => r.date >= todayStart);
        const repsToday = todayResults.reduce((sum, r) => sum + r.rep, 0);
        const sessionsToday = todayResults.length; // Approximate "Sets"

        function checkUnlock(id) {
            if (!user.achievements.includes(id)) {
                user.achievements.push(id);
                unlockedIds.push(ACHIEVEMENTS_LIST.find(a => a.id === id));
            }
        }

        // --- Conditions ---

        // Basic
        if (totalReps >= 1) checkUnlock('first_blood');
        if (totalReps >= 100) checkUnlock('century_club');

        // Streaks
        if (streak >= 5) checkUnlock('iron_streak');
        if (streak >= 30) checkUnlock('consistency_hero');

        // Daily
        if (repsToday >= 20) checkUnlock('daily_grind');

        // Tiers
        // Beginner: 15 Reps/Session (Best), 3 Days Streak, 100 Total Reps
        if (user.bestSessionRep >= 15 && streak >= 3 && totalReps >= 100) checkUnlock('tier_beginner');

        // Intermediate: 30 Reps/Session, 3 Sets/Day (Sessions Today), 500 Total Reps
        if (user.bestSessionRep >= 30 && sessionsToday >= 3 && totalReps >= 500) checkUnlock('tier_intermediate');

        // Advanced: 50 Reps/Session, 7 Days Streak, 1000 Total Reps
        if (user.bestSessionRep >= 50 && streak >= 7 && totalReps >= 1000) checkUnlock('tier_advanced');

        await user.save();

        res.json({
            success: true,
            xpGained,
            newLevel,
            levelUp,
            newAchievements: unlockedIds
        });

    } catch (err) {
        console.error("❌ Save Result Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกผล" });
    }
});

// GET Achievement List (Static + User Progress)
app.get('/api/achievements', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ success: false });

    // Mark which ones are unlocked
    const payload = ACHIEVEMENTS_LIST.map(ach => ({
        ...ach,
        unlocked: user.achievements.includes(ach.id)
    }));

    res.json({ success: true, achievements: payload, userXp: user.xp, userLevel: user.level });
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

// ================= WORKOUT HISTORY API =================
app.get('/api/history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Date Range Logic
        let { startDate, endDate } = req.query;
        let query = { username: user.username };

        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        } else {
            // Default to last 7 days if no range provided
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 7);
            query.date = { $gte: start, $lte: end };
        }

        const results = await Result.find(query).sort({ date: -1 });

        // Aggregation for Chart & Summary
        let dailyStats = {};
        let summary = { totalReps: 0, totalTime: 0, totalCalories: 0, sessionCount: results.length };

        results.forEach(r => {
            const dateKey = r.date.toISOString().split('T')[0]; // YYYY-MM-DD
            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = { date: dateKey, totalReps: 0, totalTime: 0, totalCalories: 0 };
            }

            const calories = r.rep * 0.5; // Approx formula

            dailyStats[dateKey].totalReps += r.rep;
            dailyStats[dateKey].totalTime += r.time;
            dailyStats[dateKey].totalCalories += calories;

            summary.totalReps += r.rep;
            summary.totalTime += r.time;
            summary.totalCalories += calories;
        });

        // Convert map to sorted array
        const chartData = Object.values(dailyStats).sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({
            success: true,
            summary,
            dailyStats: chartData,
            recentSessions: results.slice(0, 50) // Return recent 50 sessions for list
        });

    } catch (err) {
        console.error("❌ History Error:", err);
        res.status(500).json({ success: false, message: "Error fetching history" });
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