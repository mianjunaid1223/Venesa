const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("./logger");

const PROFILE_PATH = path.join(os.homedir(), ".venesa-profile.json");

const MAX_INTERACTIONS = 30;
const UPDATE_EVERY = 5;

const DEFAULT_PROFILE = {
    summary: "",
    interactionCount: 0,
    lastUpdated: null,
    recentInteractions: [],
};

let profile = null;
let updateInProgress = false;

function load() {
    try {
        if (fs.existsSync(PROFILE_PATH)) {
            const data = fs.readFileSync(PROFILE_PATH, "utf8").trim();
            if (data) {
                profile = { ...DEFAULT_PROFILE, ...JSON.parse(data) };
                return profile;
            }
        }
    } catch (e) {
        logger.error(`Failed to load user profile: ${e.message}`);
    }
    profile = { ...DEFAULT_PROFILE };
    return profile;
}

function save() {
    if (!profile) {
        logger.warn("Skipping profile save: profile is null");
        return;
    }
    try {
        fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
    } catch (e) {
        logger.error(`Failed to save user profile: ${e.message}`);
    }
}

function getProfile() {
    if (!profile) load();
    return profile;
}

function getSummary() {
    if (!profile) load();
    return profile.summary || "";
}

function addInteraction(query, response) {
    if (!profile) load();

    if (!query || typeof query !== "string") return;

    const cleanQuery = query.substring(0, 200).trim();
    const cleanResponse = (response || "")
        .replace(/\[action:[^\]]*\]/gi, "")
        .substring(0, 200)
        .trim();

    if (!cleanQuery) return;

    profile.recentInteractions.push({
        q: cleanQuery,
        r: cleanResponse,
        t: Date.now(),
    });

    if (profile.recentInteractions.length > MAX_INTERACTIONS) {
        profile.recentInteractions = profile.recentInteractions.slice(
            -MAX_INTERACTIONS
        );
    }

    profile.interactionCount++;
    save();
}

function shouldUpdate() {
    if (!profile) load();
    if (updateInProgress) return false;
    return profile.interactionCount > 0 &&
        profile.interactionCount % UPDATE_EVERY === 0;
}

function getInteractionsForSummary() {
    if (!profile) load();
    return profile.recentInteractions.slice(-20);
}

function updateSummary(newSummary) {
    try {
        if (!profile) load();
        if (newSummary && typeof newSummary === "string" && newSummary.trim()) {
            profile.summary = newSummary.trim();
            profile.lastUpdated = new Date().toISOString();
            save();
        }
    } finally {
        clearUpdateInProgress();
    }
}

function setUpdateInProgress() {
    updateInProgress = true;
}

function clearUpdateInProgress() {
    updateInProgress = false;
}

function getUpdatePrompt() {
    const interactions = getInteractionsForSummary();
    if (interactions.length === 0) return null;

    const conversationLog = interactions
        .map((i) => `User: ${i.q}\nVenesa: ${i.r}`)
        .join("\n---\n");

    const existingSummary = profile.summary
        ? `\nPREVIOUS PROFILE (update and refine this, don't start from scratch):\n${profile.summary}\n`
        : "";

    return `You are analyzing conversation history to build a personality profile of the USER (not the assistant).
${existingSummary}
Based on these recent conversations, write a concise personality profile of the user. Include:
- Their communication style (formal/casual, verbose/terse, etc.)
- Their humor preferences (do they joke? what kind?)
- Their typical mood and energy level
- Their interests and what they use the PC for
- How they prefer to be spoken to
- Any quirks, patterns, or preferences you notice

RULES:
- Do NOT include the user's name anywhere in the profile
- Keep it under 150 words
- Write in second person ("you" referring to the assistant reading this)
- Focus on actionable personality insights that help the assistant adapt
- Be specific, not generic
- If the user is casual, note that. If they joke, note the humor type.
- Update the previous profile with new insights, don't just rewrite it

RECENT CONVERSATIONS:
${conversationLog}

Write ONLY the personality profile, nothing else:`;
}

module.exports = {
    load,
    save,
    getProfile,
    getSummary,
    addInteraction,
    shouldUpdate,
    getInteractionsForSummary,
    updateSummary,
    setUpdateInProgress,
    clearUpdateInProgress,
    getUpdatePrompt,
};
