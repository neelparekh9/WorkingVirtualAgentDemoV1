const express = require('express');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Adjust path to root
// Used to generate responses
const OpenAI = require('openai')
const openai = new OpenAI(api_key = process.env.OPENAI_API_KEY);

// Used to Speed Up Audio (if needed)
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg'); // Import ffmpeg for audio processing
const ffmpegPath = require('ffmpeg-static'); // Path to the static binary
ffmpeg.setFfmpegPath(ffmpegPath); // Set the path explicitly

const router = express.Router()
router.use(express.static(path.join(__dirname, 'public')));
const jsonDir = path.resolve(__dirname, './json')
const { v4: uuidv4 } = require('uuid');


// If you want to use placeholders (audio/text that appears while loading), enter them in the placeholders array.

const placeholders = [
    "Let me generate a meaningful response based on what you’ve said so far.",
    "You’re doing great. I’m crafting the next part of our conversation.",
    "Thanks for being open. I’m working on generating something thoughtful based on what you’ve shared.",
    "I’m reflecting on everything so far to create the next step in our dialogue.",
    "I’m organizing my thoughts to ensure a clear and helpful response for you.",
];



// Route to generate audio for all dialogue nodes and save as JSON
// Creates a male and female audio for each placeholder.
router.get("/Placeholders", async (req, res) => {
    const audioMetadata = [];
    const outputFile = path.join(jsonDir, '/Placeholders.json');

    for (const placeholder of placeholders) {
        try {
            let audioDataF = null;
            let audioDataM = null;

            // Process nodes with dialogue
            const textToConvert = placeholder;

            // Generate audio for Female voice
            audioDataF = await generateAudio(textToConvert, 'shimmer');

            // Generate audio for Male voice
            audioDataM = await generateAudio(textToConvert, 'echo');

            const metadata = {
                dialogue: placeholder,
                audioF: audioDataF,
                audioM: audioDataM
            };

            audioMetadata.push(metadata);
        } catch (error) {
            console.error(`Error processing node ${node.nodeId}:`, error);
        }
    }

    // Save the updated JSON
    try {
        await fs.promises.writeFile(outputFile, JSON.stringify(audioMetadata, null, 2));
        console.log(`Updated JSON with audio metadata saved to ${outputFile}`);
    } catch (error) {
        console.error("Error writing updated JSON to file:", error);
        return res.status(500).json({ error: 'Failed to write updated JSON file.' });
    }

    res.json({ message: 'Audio generation complete', outputFile });
});


// Route to generate audio for all dialogue nodes and save as JSON
// This is for the pre-generated audios in the ConversationScript.json and creates "CompleteConversationScript.json"
router.get("/Script", async (req, res) => {
    const audioMetadata = [];
    const inputFile = path.join(jsonDir, '/ConversationScript.json');
    const outputFile = path.join(jsonDir, '/CompleteConversationScript.json');

    // Load the original JSON data
    let dialogueNodes;
    try {
        dialogueNodes = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    } catch (error) {
        console.error("Error reading input JSON file:", error);
        return res.status(500).json({ error: 'Failed to read input JSON file.' });
    }

    // Process each node
    for (const node of dialogueNodes) {
        try {
            let audioDataF = null;
            let audioDataM = null;

            // Process nodes with dialogue
            if (node.dialogue && (node.response == null || node.response.alterDialogue === false)) {
                const textToConvert = node.dialogue;

                // Generate audio for Female voice
                audioDataF = await generateAudio(textToConvert, 'shimmer');

                // Generate audio for Male voice
                audioDataM = await generateAudio(textToConvert, 'echo');
            }

            // Add audioM and audioF fields to the node
            const updatedNode = {
                ...node,
                audioM: audioDataM,
                audioF: audioDataF,
            };

            audioMetadata.push(updatedNode);
        } catch (error) {
            console.error(`Error processing node ${node.nodeId}:`, error);
        }
    }

    // Save the updated JSON
    try {
        await fs.promises.writeFile(outputFile, JSON.stringify(audioMetadata, null, 2));
        console.log(`Updated JSON with audio metadata saved to ${outputFile}`);
    } catch (error) {
        console.error("Error writing updated JSON to file:", error);
        return res.status(500).json({ error: 'Failed to write updated JSON file.' });
    }

    res.json({ message: 'Audio generation complete', outputFile });
});

// Function to generate audio and transcriptions
async function generateAudio(text, voice) {
    try {
        // Generate speech
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: voice,
            input: text,
            response_format: "wav",
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        const uniqueFilename = `speech_${uuidv4()}.wav`;
        const speechFile = path.resolve(__dirname, `./audio/${uniqueFilename}`);

        await fs.promises.writeFile(speechFile, buffer);

        // Adjust audio speed
        const spedUpFilename = `spedup_${uniqueFilename}`;
        const spedUpFilePath = path.resolve(__dirname, `./audio/${spedUpFilename}`);

        await new Promise((resolve, reject) => {
            ffmpeg(speechFile)
                .audioFilters('atempo=1.1') // Speed up the audio
                .save(spedUpFilePath)
                .on('end', resolve)
                .on('error', reject);
        });

        // Convert to Base64
        const spedUpBuffer = await fs.promises.readFile(spedUpFilePath);
        const audioBase64 = spedUpBuffer.toString('base64');

        // Transcribe audio
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: fs.createReadStream(spedUpFilePath),
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["word", "segment"],
        });

        if (transcriptionResponse && transcriptionResponse.words) {
            return {
                audioBase64: audioBase64,
                words: transcriptionResponse.words.map(x => x.word),
                wtimes: transcriptionResponse.words.map(x => 1000 * x.start - 150),
                wdurations: transcriptionResponse.words.map(x => 1000 * (x.end - x.start)),
            };
        }

        return null;
    } catch (error) {
        console.error("Error generating audio:", error);
        return null;
    }
}

module.exports = router;