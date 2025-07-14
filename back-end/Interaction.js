const express = require('express');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Adjust path to root
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg'); // Import ffmpeg for audio processing
const ffmpegPath = require('ffmpeg-static'); // Path to the static binary
ffmpeg.setFfmpegPath(ffmpegPath); // Set the path explicitly

// If you want to use OpenAI for audio generation only
const OpenAI = require('openai');
const openai = new OpenAI({apiKey : process.env.OPENAI_API_KEY});

const router = express.Router();
router.use(express.static(path.join(__dirname, 'public')));
const jsonDir = path.resolve(__dirname, './json');
const { v4: uuidv4 } = require('uuid');

// Script to follow regardless of user input
const scriptSequence = [
    {
        nodeId: 1,
        dialogue: "Alex, we're excited about you joining our team. We're offering $85,000 per year, plus benefits. Do you have any questions?",
        input: {
            nextNode: 2
        },
        options: [
            { optionText: "Ask about career growth", nextNode: 2 }
        ]
    },

    {
        nodeId: 2,
        dialogue: "We offer an annual $2,000 learning stipend and mentorship programs. There's also a 10% performance-based bonus on top of your salary.",
        input: {
            nextNode: 3
        }
    },

    {
        nodeId: 3,
        dialogue: "I see where you're coming from. We can do $90,000 and increase your learning stipend to $3,000.",
        input: {
            nextNode: 4
        }
    },

    {
        nodeId: 4,
        dialogue: "Agreed! Welcome to the team.",
        input: {
            nextNode: 5
        }
    },
    {
        nodeId: 5,
        dialogue: "Great!",
        input: {
            nextNode: 6
        }
        
    },
    {
        nodeId: 6,
        dialogue: "Would you like to restart the conversation?",
        input: {
            nextNode: 1
        }
    }
];

// The main function to handle user input
router.post('/:nodeId', async (req, res, next) => {
    const nodeId = parseInt(req.params.nodeId);
    const additionalData = req.body || {};
    const gender = "female";
    
    try {
        // Find script step that matches the nodeId
        const scriptStep = scriptSequence.find(step => step.nodeId === nodeId);
        
        if (!scriptStep) {
            console.error(`Node with ID ${nodeId} not found.`);
            return res.status(404).json({ error: `Node with ID ${nodeId} not found` });
        }
        
        console.log(`Processing nodeId: ${nodeId}, Script step:`, scriptStep);
        
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        // Generate audio for the dialogue
        const dialogue = scriptStep.dialogue;
        const sentences = splitTextIntoSentences(dialogue);
        
        // Process first sentence immediately
        const firstSentence = sentences[0];
        const firstChunk = await processSentence(firstSentence, {
            nodeId: nodeId,
            dialogue: dialogue,
            wholeDialogue: dialogue,
            input: scriptStep.input,
            options: scriptStep.options || []
        }, true);
        
        res.write(JSON.stringify(firstChunk) + '\n');
        
        // Process remaining sentences concurrently
        const remainingChunksPromises = sentences.slice(1).map((sentence, index) =>
            processSentence(sentence, {
                nodeId: nodeId,
                dialogue: dialogue,
                wholeDialogue: dialogue,
                input: scriptStep.input,
                options: scriptStep.options || []
            }, false)
        );
        
        try {
            const remainingChunks = await Promise.all(remainingChunksPromises);
            
            // Stream remaining chunks as they finish
            remainingChunks.forEach(chunk => {
                res.write(JSON.stringify(chunk) + '\n');
            });
            
            // Send the final response data
            const responseData = {
                nodeId: nodeId,
                dialogue: dialogue,
                audio: null,
                input: scriptStep.input || null,
                options: scriptStep.options || [],
                type: "END CHUNK",
                wholeDialogue: dialogue
            };
            
            console.log("Sending final response:", responseData);
            res.write(JSON.stringify(responseData) + '\n');
            res.end();
            
        } catch (err) {
            console.error('Error processing remaining chunks:', err);
            res.status(500).end();
        }
        
    } catch (err) {
        console.error('Error during request processing:', err);
        return res.status(500).json({ error: 'Failed to process request' });
    }
});

// Helper function to process a single sentence
async function processSentence(sentence, nodeData, isFirstChunk) {
    const chunkType = isFirstChunk ? "NEW AUDIO" : "CHUNK";
    const createdFiles = [];
    const tempDir = './audio'; // Directory for temporary files
    const gender = 'female';

    try {
        // Ensure /tmp directory exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
            console.log(`Created directory: ${tempDir}`);
        }
        const voice = gender === "male" ? 'echo' : 'shimmer';

        // Generate audio
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: voice,
            input: sentence,
            response_format: "wav",
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        const uniqueFilename = `speech_${uuidv4()}.wav`;
        const speechFile = path.join(tempDir, uniqueFilename);
        await fs.promises.writeFile(speechFile, buffer);
        createdFiles.push(speechFile);

        // Speed up audio
        const spedUpFilename = `spedup_${uniqueFilename}`;
        const spedUpFilePath = path.join(tempDir, spedUpFilename);
        await new Promise((resolve, reject) => {
            ffmpeg(speechFile)
                .audioFilters('atempo=1.1')
                .save(spedUpFilePath)
                .on('end', resolve)
                .on('error', reject);
        });
        createdFiles.push(spedUpFilePath);

        // Convert to Base64
        const spedUpBuffer = await fs.promises.readFile(spedUpFilePath);
        const audioBase64 = spedUpBuffer.toString('base64');

        // Transcription
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: fs.createReadStream(spedUpFilePath),
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["word", "segment"],
        });

        const sentenceAudio = transcriptionResponse?.words
            ? {
                audioBase64,
                words: transcriptionResponse.words.map(x => x.word),
                wtimes: transcriptionResponse.words.map(x => 1000 * x.start - 150),
                wdurations: transcriptionResponse.words.map(x => 1000 * (x.end - x.start)),
            }
            : { audioBase64 };

        return {
            nodeId: nodeData.nodeId,
            dialogue: sentence,
            audio: sentenceAudio,
            input: nodeData.input || null,
            options: nodeData.options || [],
            type: chunkType,
            wholeDialogue: nodeData.wholeDialogue
        };
    } catch (error) {
        console.error("Error processing sentence:", error);
        return { error: `Failed to process sentence: ${sentence}` };
    } finally {
        // Cleanup: Delete all created audio files
        for (const filePath of createdFiles) {
            try {
                await fs.promises.unlink(filePath);
                // console.log(`Deleted file: ${filePath}`);
            } catch (cleanupError) {
                console.error(`Failed to delete file: ${filePath}`, cleanupError);
            }
        }
    }
}

function splitTextIntoSentences(text) {
    // Modern approach using Intl.Segmenter
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        return Array.from(segmenter.segment(text), segment => segment.segment);
    }

    // Fallback for environments without Intl.Segmenter
    return text.match(/[^.!?]+[.!?]+/g) || [text];
}

module.exports = router;