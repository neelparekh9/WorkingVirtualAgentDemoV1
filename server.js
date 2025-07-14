const express = require('express');
const session = require('express-session');
const path = require('path');
const baseDir = path.join(__dirname);
const InteractionRouter = require('./back-end/Interaction');
const GenerateRouter = require('./back-end/GenerateScripts');
const app = express();

// Setup EJS if you are rendering EJS templates (not mandatory for serving static frontend)
app.set('view engine', 'ejs');

// Serve static files from the public directory (for frontend: index.html, index.css, index.js)
app.use(express.static(path.join(__dirname, 'front-end')));

// To handle JSON requests
app.use(express.json());

// Session configuration
app.use(session({
    secret: process.env.SESSION_KEY, // Make sure SESSION_KEY is in your .env
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        maxAge: 1000 * 60 * 20, // Session lasts for 20 minutes
    }
}));

// <--- Routes --->
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'front-end', 'interaction.html'));
});

app.use('/Interaction', (req, res, next) => {
    next();
}, InteractionRouter);

app.use('/Generate', (req, res, next) => {
    next();
}, GenerateRouter);



process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Decide whether to keep the process alive or shut it down
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Optionally handle cleanup or decide to shut down gracefully
});


app.listen(process.env.PORT || 3000, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT || 3000}`);
});
