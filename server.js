const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static HTML/CSS/JS files so redirecting to /Home.html works
app.use(express.static(__dirname));

const { MongoMemoryServer } = require('mongodb-memory-server');

// Initialize MongoDB Connection
const connectDB = async () => {
  try {
    let MONGODB_URI = process.env.MONGO_URI;

    // Use memory server if Atlas URI is rejected or missing
    if (!MONGODB_URI || MONGODB_URI.includes('127.0.0.1')) {
        const mongoServer = await MongoMemoryServer.create();
        MONGODB_URI = mongoServer.getUri();
        console.log("Using local Memory Database (no Atlas connection detected).");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB securely connected!");
  } catch (err) {
    console.error("Failed to connect to MongoDB. Starting local Memory Database instead...");
    const mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    console.log("Memory Database started successfully!");
  }
};

connectDB();

// Task Schema
const taskSchema = new mongoose.Schema({
  name: String,
  category: String,
  date: String,
  time: String, // HH:MM format for Google Calendar timed events & reminders
  duration: { type: Number, default: 60 }, // Duration in minutes (default 1 hour)
  priority: String,
  status: { type: String, default: 'Pending' },
  userId: String // to associate tasks with users (using their email or name for now)
});

const Task = mongoose.model('Task', taskSchema);

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  googleTokens: { type: Object }
});

const User = mongoose.model('User', userSchema);

// Routes
// --- User Authentication Routes ---
app.post('/api/users/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
    }

    const newUser = new User({ name, email, password });
    await newUser.save();
    
    res.json({ message: "Signup successful", user: { name: newUser.name, email: newUser.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { name, password } = req.body; // Original frontend sends enteredName
    
    // We check against name instead of email because the login form has an ID 'UserName'
    const user = await User.findOne({ name, password });
    
    if (user) {
        res.json({ message: "Login successful", user: { name: user.name, email: user.email } });
    } else {
        res.status(401).json({ error: "Invalid username or password" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Google OAuth Setup ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

app.get('/api/auth/google', (req, res) => {
  const userId = req.query.userId || 'guest';
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ],
    state: userId,
    prompt: 'select_account consent'
  });
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const userId = req.query.state; // We passed userId in state

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    // Decode the JWT id_token to get email and name securely without extra API calls!
    const base64Url = tokens.id_token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');
    const userInfoData = JSON.parse(jsonPayload);

    const gEmail = userInfoData.email;
    const gName = userInfoData.name || 'Google User';

    // Find or create user
    let user = await User.findOne({ email: gEmail });
    if (!user) {
      user = new User({
        name: gName,
        email: gEmail,
        password: 'google_oauth_no_password',
        googleTokens: tokens
      });
    } else {
      user.googleTokens = tokens;
      // Also update name if needed
      if (!user.name) user.name = gName;
    }
    await user.save();
    
    // Redirect back to frontend and set localStorage
    const safeName = (user.name || 'Google User').replace(/'/g, "\\'");
    const safeEmail = (user.email || '').replace(/'/g, "\\'");

    res.send(`
    <script>
      localStorage.setItem('userName', '${safeName}');
      localStorage.setItem('userEmail', '${safeEmail}');
      localStorage.setItem('authStatus', 'returning_user');
      window.location.href = '/HOME.html';
    </script>`);
  } catch (err) {
    console.error('Error fetching oAuth tokens', err);
    res.status(500).send('Login failed');
  }
});

// --- Task Routes ---

// Sync Tasks with Calendar (MUST be before /:userId to avoid route conflicts)
app.post('/api/tasks/sync/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log('[SYNC] Starting sync for userId:', userId);
    
    const user = await User.findOne({ $or: [{ email: userId }, { name: userId }] });
    
    if (!user) {
      console.log('[SYNC] User not found in DB');
      return res.status(401).json({ error: "User not found", notLinked: true });
    }
    if (!user.googleTokens) {
      console.log('[SYNC] User has no googleTokens');
      return res.status(401).json({ error: "Google account not linked", notLinked: true });
    }

    console.log('[SYNC] Found user:', user.email, '| Has refresh_token:', !!user.googleTokens.refresh_token);

    // Create a FRESH oauth2 client per request to avoid shared state
    const syncAuth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );
    syncAuth.setCredentials(user.googleTokens);
    
    // Handle token refresh automatically
    syncAuth.on('tokens', async (newTokens) => {
      console.log('[SYNC] Tokens refreshed, saving to DB');
      if (newTokens.refresh_token) {
        user.googleTokens = { ...user.googleTokens, ...newTokens };
      } else {
        user.googleTokens = { ...user.googleTokens, access_token: newTokens.access_token, expiry_date: newTokens.expiry_date };
      }
      await user.save();
    });

    const calendar = google.calendar({ version: 'v3', auth: syncAuth });
    
    // ===== STEP 1: PUSH local TaskMaster tasks TO Google Calendar =====
    const localTasks = await Task.find({ userId: { $in: [user.email, user.name, userId] } });
    console.log('[SYNC] Found', localTasks.length, 'local tasks to push to Google Calendar');
    let pushedCount = 0;
    
    // Fetch existing Google Calendar events to avoid duplicates
    const now = new Date();
    const existingEventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(now.getFullYear() - 1, 0, 1).toISOString(), // 1 year back
      maxResults: 2500,
      singleEvents: true,
    });
    const existingEvents = existingEventsRes.data.items || [];
    const existingEventNames = new Set(existingEvents.map(e => e.summary).filter(Boolean));
    console.log('[SYNC] Found', existingEvents.length, 'existing Google Calendar events');

    for (const task of localTasks) {
      // Skip if already exists in Google Calendar (by name match)
      if (existingEventNames.has(task.name)) {
        console.log('[SYNC] Skipping (already in calendar):', task.name);
        continue;
      }
      
      // Build the event
      let eventDate = task.date;
      if (!eventDate) {
        // If no date, use today
        eventDate = now.toISOString().split('T')[0];
      }

      let event;
      if (task.time) {
        // Timed event — enables Google Calendar reminders/notifications
        const startDateTime = `${eventDate}T${task.time}:00`;
        // End time = start + task duration (default 60 min)
        const durationMin = task.duration || 60;
        const [h, m] = task.time.split(':').map(Number);
        const totalMin = h * 60 + m + durationMin;
        const endH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
        const endM = String(totalMin % 60).padStart(2, '0');
        const endDateTime = `${eventDate}T${endH}:${endM}:00`;
        
        // Detect user timezone (fallback to IST since user is in India)
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
        
        event = {
          summary: task.name,
          description: `Category: ${task.category || 'General'} | Priority: ${task.priority || 'None'} | Status: ${task.status || 'Pending'}\n\n[Synced from TaskMaster]`,
          start: {
            dateTime: startDateTime,
            timeZone: timeZone,
          },
          end: {
            dateTime: endDateTime,
            timeZone: timeZone,
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 30 },
              { method: 'email', minutes: 60 },
            ],
          },
        };
      } else {
        // All-day event (no time set)
        event = {
          summary: task.name,
          description: `Category: ${task.category || 'General'} | Priority: ${task.priority || 'None'} | Status: ${task.status || 'Pending'}\n\n[Synced from TaskMaster]`,
          start: {
            date: eventDate,
          },
          end: {
            date: eventDate,
          },
        };
      }

      try {
        await calendar.events.insert({
          calendarId: 'primary',
          resource: event,
        });
        pushedCount++;
        console.log('[SYNC] Pushed to Google Calendar:', task.name, '| Date:', eventDate);
      } catch (pushErr) {
        console.error('[SYNC] Failed to push task:', task.name, pushErr.message);
      }
    }

    // ===== STEP 2: PULL Google Calendar events INTO TaskMaster =====
    console.log('[SYNC] Now pulling events from Google Calendar...');
    const pullEventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const pullEvents = pullEventsRes.data.items || [];
    console.log('[SYNC] Found', pullEvents.length, 'upcoming calendar events to pull');
    let pulledCount = 0;
    
    for (const event of pullEvents) {
      if (!event.summary) continue;
      
      // Check if already exists locally
      const existing = await Task.findOne({ userId: user.email, name: event.summary });
      if (!existing) {
        const start = event.start.dateTime || event.start.date;
        const taskDate = start ? start.split('T')[0] : '';
        // Extract time if it's a timed event
        let taskTime = '';
        if (event.start.dateTime) {
          const dtParts = event.start.dateTime.split('T');
          if (dtParts[1]) {
            taskTime = dtParts[1].substring(0, 5); // HH:MM
          }
        }
        const newTask = new Task({
          name: event.summary,
          category: 'other',
          date: taskDate,
          time: taskTime,
          priority: 'medium',
          status: 'Pending',
          userId: user.email
        });
        await newTask.save();
        pulledCount++;
        console.log('[SYNC] Pulled from Google Calendar:', event.summary, '| Date:', taskDate);
      }
    }
    
    console.log('[SYNC] Sync complete. Pushed:', pushedCount, '| Pulled:', pulledCount);
    res.json({ 
      message: "Sync complete", 
      pushedCount, 
      pulledCount, 
      totalLocalTasks: localTasks.length,
      totalCalendarEvents: pullEvents.length 
    });
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
    console.error('[SYNC] Full error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get tasks for a user
app.get('/api/tasks/:userId', async (req, res) => {
  try {
    const tasks = await Task.find({ userId: req.params.userId });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a task
app.post('/api/tasks', async (req, res) => {
  try {
    const newTask = new Task(req.body);
    await newTask.save();
    res.json(newTask);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const updatedTask = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedTask);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete tasks (supports bulk delete)
app.post('/api/tasks/delete', async (req, res) => {
  try {
    const { ids } = req.body;
    await Task.deleteMany({ _id: { $in: ids } });
    res.json({ message: "Tasks deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 5005;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
