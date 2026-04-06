const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Initialize Firebase
const serviceAccount = require("./women-safety-app-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Test Route
app.get("/", (req, res) => {
  res.send("Women Safety API is running!");
});

// ✅ Add a safety hotspot
app.post("/add-hotspot", async (req, res) => {
  try {
    const { latitude, longitude, description } = req.body;
    if (!latitude || !longitude || !description) {
      return res.status(400).send({ error: "Missing required fields!" });
    }

    const newHotspot = { latitude, longitude, description, timestamp: Date.now() };
    const docRef = await db.collection("hotspots").add(newHotspot);

    console.log(`✅ Hotspot Added: ${docRef.id}`, newHotspot);
    res.status(200).send({ message: "Hotspot added successfully!", id: docRef.id });
  } catch (error) {
    console.error("❌ Error Adding Hotspot:", error.message);
    res.status(500).send({ error: error.message });
  }
});

// ✅ Get all safety hotspots
app.get("/hotspots", async (req, res) => {
  try {
    console.log("📍 Fetching Hotspots from Firebase...");
    
    const snapshot = await db.collection("hotspots").get();
    if (snapshot.empty) {
      console.log("⚠️ No Hotspots Found");
      return res.status(200).json({ message: "No hotspots available!" });
    }

    let hotspots = [];
    snapshot.forEach((doc) => hotspots.push({ id: doc.id, ...doc.data() }));

    console.log("📍 Hotspots Retrieved:", hotspots);
    res.status(200).json(hotspots);
  } catch (error) {
    console.error("❌ Error Fetching Hotspots:", error.message);
    res.status(500).send({ error: error.message });
  }
});

// ✅ Start Server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
  console.log("🔥 Firebase connected successfully!");
});
