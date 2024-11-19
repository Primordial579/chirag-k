const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const AWS = require("aws-sdk");
const multer = require("multer");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// S3 Configuration
const s3 = new AWS.S3({
  accessKeyId: "AKIAYHJANJGM4VWAB7HI", // Replace with your AWS Access Key
  secretAccessKey: "eIw59VyagCBO4k0ke7Jek3/ICx8/scgLLGPd290b", // Replace with your AWS Secret Key
  region: "ap-south-1", // Replace with your AWS Region
});

// MySQL Database Configuration
const db = mysql.createPool({
  host: "db3.ch4qywaga5wq.ap-south-1.rds.amazonaws.com", // Replace with your RDS Host
  user: "admin", // Replace with your RDS User
  password: "Kammavari123", // Replace with your RDS Password
  database: "Arjav", // Replace with your Database Name
});

// JWT Secret Key
const JWT_SECRET = "57958"; // Replace with your JWT Secret

// Multer Configuration for File Upload
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ message: "Invalid token" });
  }
};

// Helper: Initialize Database Tables
const initializeTables = async () => {
  try {
    // Create 'users' table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create 'records' table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Error initializing database tables:", err.message);
  }
};

// Routes

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.execute("INSERT INTO users (username, password) VALUES (?, ?)", [
      username,
      hashedPassword,
    ]);
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password" });

    const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get User-Specific Table
app.get("/table", verifyToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM records WHERE user_id = ?",
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Row
app.post("/table", verifyToken, async (req, res) => {
  const { name } = req.body;
  try {
    const [result] = await db.execute(
      "INSERT INTO records (user_id, name) VALUES (?, ?)",
      [req.user.userId, name]
    );
    res.status(201).json({ id: result.insertId, message: "Row added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Image and Update Record
app.post("/upload/:id", verifyToken, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const file = req.file;
  const folder = `users/${req.user.username}`;
  const key = `${folder}/${file.originalname}`;

  try {
    // Upload the image to S3 with public-read ACL
    const uploadResult = await s3
      .upload({
        Bucket: "dbtest57", // Replace with your S3 bucket name
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',  // Ensure the file is publicly accessible
      })
      .promise();

    // Save the image URL in the database for the specific record
    await db.execute(
      "UPDATE records SET image_url = ? WHERE id = ? AND user_id = ?",
      [uploadResult.Location, id, req.user.userId]
    );

    res.json({ url: uploadResult.Location });  // Return the public URL of the image
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Row
app.delete("/table/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute("DELETE FROM records WHERE id = ? AND user_id = ?", [
      id,
      req.user.userId,
    ]);
    res.json({ message: "Row deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Row
app.put("/table/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    await db.execute(
      "UPDATE records SET name = ? WHERE id = ? AND user_id = ?",
      [name, id, req.user.userId]
    );
    res.json({ message: "Row updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize Tables and Start Server
(async () => {
  await initializeTables(); // Ensure tables are created before the server starts
  app.listen(PORT, () =>
    console.log(`Server running at http://localhost:${PORT}`)
  );
})();
