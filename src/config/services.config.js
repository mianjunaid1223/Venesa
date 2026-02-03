module.exports = {
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",

    tts: {
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      model: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
      stability: 0.7,
      similarityBoost: 0.7,
      style: 0.5,
      useSpeakerBoost: true,
    },

    stt: {
      model: "scribe_v1",
      language: "en",
    },

    timeout: 30000,
    maxRetries: 3,
  },

  gemini: {
    model: "gemini-2.5-flash-lite",
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 800,
      candidateCount: 1,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
    timeout: 30000,
    maxRetries: 3,
  },
};
