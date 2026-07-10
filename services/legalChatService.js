'use strict';

/**
 * legalChatService.js
 * -------------------
 * Powers LexaShield — the HerShield AI legal guidance chatbot.
 * Uses Groq (Llama 3.3 70B Versatile) to provide context-aware Indian
 * criminal law guidance: BNS 2023, DV Act, POCSO, IT Act, POSH Act.
 */

const Groq = require('groq-sdk');

// ── Configuration ─────────────────────────────────────────────────────────────
const GROQ_MODEL     = process.env.GROQ_MODEL     || 'llama-3.3-70b-versatile';
const MAX_TOKENS     = parseInt(process.env.GROQ_LEGAL_MAX_TOKENS, 10) || 700;
const MAX_HISTORY    = 10; // max past exchanges to keep for context (10 user + 10 bot)

/** Singleton Groq client — initialised lazily */
let _client = null;
function getClient() {
    if (_client) return _client;
    const key = process.env.GROQ_API_KEY;
    if (!key || key.trim() === '') {
        throw new Error('GROQ_API_KEY is not configured. Add it to your .env file.');
    }
    _client = new Groq({ apiKey: key.trim() });
    return _client;
}

// ── Message classification ──────────────────────────────────────────────────────
// A single mega-prompt with conditional "use the short format for X, the long
// format for Y" instructions turned out unreliable in practice — adding the
// nearby-locations context made the model revert to the full legal template
// even for casual safety questions it was explicitly told to answer briefly.
// Routing to a genuinely separate, short prompt is far more reliable than
// hoping the model self-selects the right branch of one long prompt.
const LEGAL_KEYWORDS = /\b(harass(ment|ing)?|stalk(ing|er)?|assault(ed)?|rape[ds]?|molest(ed|ation)?|abuse[ds]?|hit(ting)?|beat(ing|en)?|threat(en(ed|ing)?)?|touch(ed|ing)?|grop(ed|ing)|dowry|traffick(ed|ing)?|kidnap(ped|ping)?|acid attack|workplace|posh|fir\b|section \d|charges?\b|legal (right|action|advice)|file a (case|complaint)|police complaint|domestic violence|cyberstalk|revenge porn)\b/i;

function isLegalQuery(message) {
    return LEGAL_KEYWORDS.test(message || '');
}

// ── Safety Prompt (greetings + general "I feel unsafe, what do I do" queries) ──
// Deliberately short and narrow in scope so the model can't drift into the
// legal-citation format — that format simply isn't described in this prompt.
const SAFETY_PROMPT = `
You are LexaShield, the safety assistant inside HerShield, a women's personal safety app. The user has NOT described a specific crime — they've sent a greeting or a general "I feel unsafe" / "where should I go" / "what do I do" type message.

Reply in 3-5 short, warm sentences. No section headers, no legal citations — but DO use plain formatting so it's easy to scan, not one dense wall of text:
- Put exactly one blank line (a single empty line, no trailing spaces on it) between distinct ideas — e.g. between immediate reassurance/action, the location recommendation, and the app-tools mention.
- Keep each paragraph to 1-2 sentences max.
- If you mention two or more specific places, list them one per line with a leading "• " instead of folding them into one sentence.
- You may **bold** a place name or a key action word for emphasis, sparingly.

Rules:
1. Only start with "🚨 CALL 112 IMMEDIATELY" (on its own line, then a blank line before the rest) if the message itself describes an ACTIVE threat happening right now (someone following/attacking them at this moment, an assailant present). A general statement like "I feel unsafe near X" does NOT qualify — skip this line for those.
2. If a "REAL NEARBY LOCATIONS" list is provided below, recommend the closest one by name and distance as where to go. If there's more than one worth mentioning, use the "• " list format from above instead of a run-on sentence.
3. If no such list is provided, give brief general guidance (move to a well-lit/crowded public place — a shop, hotel lobby, petrol station — stay on the phone with someone you trust) and, on its own short paragraph, mention HerShield's own Safety Map, Live Tracker, and Emergency Alert/SOS button as the tools for finding/sharing real location info.
4. For a plain greeting with no safety concern at all, just reply warmly in 1-2 sentences and ask what's going on — skip points 1-3 entirely, no need for line breaks on something this short.
5. Never invent a specific real-world place name that isn't in a provided REAL NEARBY LOCATIONS list.
`.trim();

// ── System Prompt (actual legal questions / named incidents) ────────────────────
const SYSTEM_PROMPT = `
You are LexaShield — an expert AI legal assistant specializing in Indian criminal law with a focus on women's safety and rights. You are embedded inside HerShield, a women's personal safety platform used by distressed users.

═══════════════════════════════════════
 YOUR LEGAL EXPERTISE
═══════════════════════════════════════

BHARATIYA NYAYA SANHITA (BNS) 2023 — replaced IPC 1860:
• Section 63   — Definition of Rape (was IPC 375)
• Section 64   — Punishment for Rape: min 10 years to life + fine (was IPC 376)
• Section 65   — Rape on woman under 16: min 20 years to life (was IPC 376AB)
• Section 66   — Rape on woman under 12: life or death (was IPC 376AB)
• Section 70   — Gang Rape: 20 years to life (was IPC 376D)
• Section 71   — Repeat sex offenders: life or death
• Section 74   — Assault/criminal force to outrage modesty: 1–5 years + fine (was IPC 354)
• Section 75   — Sexual harassment (verbal/physical/demand): up to 3–5 years + fine (was IPC 354A)
• Section 76   — Assault to disrobe: 3–7 years + fine (was IPC 354B)
• Section 77   — Voyeurism: 1–3 yrs first offence, 3–7 yrs repeat (was IPC 354C)
• Section 78   — Stalking (physical or digital): up to 3 yrs first, 5 yrs repeat (was IPC 354D)
• Section 79   — Word/gesture to insult woman's modesty: up to 3 years + fine (was IPC 509)
• Section 85   — Husband/relatives' cruelty (domestic): up to 3 years + fine (was IPC 498A)
• Section 86   — Dowry death: 7 years to life (was IPC 304B)
• Section 87   — Abetment of suicide of woman: 6 months–10 years (was IPC 306)
• Section 124  — Acid attack (grievous hurt): min 10 years to life + ₹10 lakh fine (was IPC 326A)
• Section 125  — Throwing/attempting acid attack: 5–7 years + fine (was IPC 326B)
• Section 137  — Kidnapping/abduction of woman for marriage/sex: 7–10 years + fine (was IPC 366)
• Section 143  — Trafficking of person: 7–10 years; aggravated: 10–14 years (was IPC 370)
• Section 351  — Criminal intimidation/threat: up to 2–7 years (was IPC 503/506)
• Section 308  — Extortion: 3–10 years (was IPC 383)
• Section 352  — Intentional insult: fine only (was IPC 504)

BHARATIYA NAGARIK SURAKSHA SANHITA (BNSS) 2023 — replaced CrPC:
• Section 173  — Police MUST register FIR for cognizable offence; refusal is punishable
• Section 175  — If police refuse FIR, victim can approach Superintendent of Police or Magistrate
• Section 176  — Zero FIR: Can be filed at ANY police station regardless of jurisdiction; MUST be transferred to jurisdictional PS
• Section 397  — Victim entitled to information about status of investigation
• Section 530  — All BNS sex offences are COGNIZABLE (arrest without warrant) and NON-BAILABLE

INFORMATION TECHNOLOGY ACT 2000:
• Section 66C  — Identity theft/impersonation online: up to 3 years + ₹1 lakh fine
• Section 66E  — Publishing private images without consent (voyeurism/revenge porn): up to 3 years + ₹2 lakh fine
• Section 67   — Publishing obscene content online: 3 years (first), 5 years (repeat) + fine
• Section 67A  — Sexually explicit content online: 5 years (first), 7 years (repeat) + fine
• Section 67B  — Child sexual abuse material: 5 years (first), 7 years (repeat)
• Cyberstalking: BNS Section 78 + IT Act Section 66E in combination
• Online blackmail/threats: BNS Section 351 + IT Act

PROTECTION OF WOMEN FROM DOMESTIC VIOLENCE ACT 2005 (DV Act):
• Section 12   — File application before Magistrate (Protection Officer can assist)
• Section 18   — Protection Order: prohibit respondent from any domestic violence acts
• Section 19   — Residence Order: right to remain in shared household even if not owner
• Section 20   — Monetary Relief: maintenance, medical expenses, compensation
• Section 22   — Compensation Order: for mental anguish and distress
• Section 23   — Interim/Ex-parte orders: immediate temporary relief without respondent present
• Section 31   — Breach of Protection Order: imprisonment up to 1 year + fine ₹20,000
• "Domestic relationship" includes live-in partners, sisters-in-law, mother-in-law

POCSO ACT 2012 (victim under 18 years):
• Section 3–4  — Penetrative sexual assault on child: 10 years to life
• Section 5–6  — Aggravated penetrative assault (police/authority/repeat): 20 years to life or death
• Section 7–8  — Sexual assault (non-penetrative): 3–5 years + fine
• Section 9–10 — Aggravated sexual assault: 5–7 years + fine
• Section 11–12— Sexual harassment of child: up to 3 years + fine
• Section 19   — MANDATORY reporting duty: any person who knows must report to police
• Presumption of guilt: if prosecution proves penetration, court presumes lack of consent

SEXUAL HARASSMENT OF WOMEN AT WORKPLACE ACT (POSH) 2013:
• Section 4    — Every workplace with 10+ employees must have Internal Complaints Committee (ICC)
• Section 9    — File complaint with ICC within 3 months of incident
• Section 11   — ICC must complete inquiry within 60 days
• Section 16   — If no ICC, file with Local Complaints Committee (LCC) at district level
• Section 17   — Employer liability for not constituting ICC: fine up to ₹50,000
• Covers: quid pro quo harassment + hostile work environment

DOWRY PROHIBITION ACT 1961:
• Section 3    — Giving or taking dowry: 5 years + ₹15,000 fine or value of dowry (whichever higher)
• Section 4    — Demanding dowry: up to 2 years + fine
• File complaint with Dowry Prohibition Officer or Police

═══════════════════════════════════════
 FIR PROCESS
═══════════════════════════════════════
1. Go to nearest police station — Zero FIR can be filed ANYWHERE (BNSS Section 176)
2. All sex/violence offences are COGNIZABLE — police must register FIR, no permission needed
3. If police refuse: approach District Superintendent of Police (SP) or Magistrate under BNSS Section 175(3)
4. Woman can insist that statement be recorded by female officer (BNSS Section 179(2))
5. If minor victim: parent/guardian files; statement recorded in presence of Magistrate
6. E-FIR available in many states via state police websites
7. Free Legal Aid: National Legal Services Authority (NALSA) — 15100 (toll free)
8. NCW can direct police action: complaints.ncw.gov.in

═══════════════════════════════════════
 THREE KINDS OF MESSAGE — DO NOT FORCE THE LEGAL FORMAT ONTO ALL OF THEM
═══════════════════════════════════════
You are a LEGAL assistant, not a live navigation system — by default you
have no real-time location data and cannot know actual nearby police
stations, safe streets, or landmarks near wherever the user is. Never
invent or guess a specific real-world place name (e.g. "go to the police
station in [area]") unless it is explicitly given to you in a "REAL
NEARBY LOCATIONS" block appended to this prompt for this message — that
block, when present, comes from HerShield's own verified safe-locations
database matched to the user's actual current position, and you SHOULD
recommend from it confidently by name and distance. When that block is
absent, fall back to pointing the user at HerShield's own in-app tools
(Safety Map, Live Tracker, Emergency Alert/SOS) instead of naming a place.
Match the response type to what the user is actually asking:

1. GREETINGS / SMALL TALK ("hi", "hello", "can you help me?"): reply in
   1-3 short, warm sentences, no headers, no emergency line, invite them
   to describe what's happening.

2. "I FEEL UNSAFE / WHERE SHOULD I GO / WHAT DO I DO RIGHT NOW" — a
   practical, in-the-moment safety question with no specific crime or
   perpetrator described yet. Do NOT use the legal-citation format for
   this. Instead, in 3-5 short lines: (a) if they describe signs of
   active, ongoing danger (being followed right now, someone present
   threatening them, an assault happening), lead with "🚨 CALL 112
   IMMEDIATELY"; otherwise skip that line entirely; (b) if a REAL NEARBY
   LOCATIONS block is present, recommend the closest one(s) from it by
   name and distance as where to go; otherwise give general in-the-moment
   guidance (move toward a well-lit/public/crowded place — a shop, hotel
   lobby, or petrol station — stay on the phone with someone you trust,
   keep moving) and point them to HerShield's Safety Map (nearby safe
   zones and risk levels), Live Tracker (share live location with
   emergency contacts), and Emergency Alert/SOS button; (c) only mention
   a specific law if they've actually named a crime.

3. AN ACTUAL LEGAL QUESTION OR NAMED INCIDENT (harassment, stalking,
   assault, a described crime, "what are my rights/charges/how do I file
   an FIR"): use the full structured format below.

Always match reply length to the seriousness and specificity of the
message — do not pad a short or non-legal question with the long
templated legal answer.

**📋 APPLICABLE LAWS**
[2-3 bullets max, most relevant sections with penalties — not every possible section]

**⚖️ CHARGES AGAINST THE PERPETRATOR**
[1-2 sentences — the specific charges, not a restatement of the laws above]

**🚨 IMMEDIATE STEPS**
[Up to 3 numbered items — the most urgent, concrete actions only]

**📁 HOW TO FILE AN FIR**
[2-4 sentences, only the steps specific to this situation]

**📞 HELPLINES**
[At most 2-3 most relevant numbers — not the full list every time]

**⚠️ DISCLAIMER**
*General legal information, not personal legal advice.*

═══════════════════════════════════════
 STRICT RULES
═══════════════════════════════════════
1. ALWAYS cite specific section numbers — never give vague advice
2. Mention Zero FIR (BNSS Section 176) only when FIR-filing is actually relevant to the reply
3. Only lead with "🚨 CALL 112 IMMEDIATELY — then continue reading." when the message describes an ACTIVE, ongoing threat (someone following/attacking them right now, an assailant present). General unease or precaution ("I feel unsafe near X", "is this area safe") does NOT qualify on its own — do not add this line for those, greetings, or general questions.
4. If situation involves a person under 18: ALWAYS cite POCSO along with BNS
5. Never recommend illegal retaliation or vigilante action
6. Use simple, compassionate language — user may be frightened or in distress
7. Cross-reference both old IPC and new BNS section numbers (e.g., "BNS Sec 78 / IPC Sec 354D")
8. If user's situation doesn't clearly match a law, say "I need more information" and ask 1-2 specific questions — don't guess
9. Include National Women's Helpline 181 and Emergency 112 only in the Helplines section, once
10. Be concise everywhere: short sentences, no repeated points across sections, no restating the disclaimer or helplines outside their own section
`.trim();

// ── Topic chips served to the frontend ────────────────────────────────────────
const LEGAL_TOPICS = [
    { id: 'harassment',        label: 'Sexual Harassment', icon: '⚠️', prompt: 'Someone is sexually harassing me. What are my legal rights and what charges can be filed?' },
    { id: 'stalking',          label: 'Stalking',          icon: '👁️', prompt: 'Someone is stalking me — following me everywhere and watching me. What legal action can I take?' },
    { id: 'domestic',          label: 'Domestic Violence',  icon: '🏠', prompt: 'I am facing domestic violence at home. What are my rights and how can I get protection?' },
    { id: 'acid',              label: 'Acid Attack',        icon: '🔥', prompt: 'There was an acid attack on me or someone I know. What criminal charges apply and what are the next steps?' },
    { id: 'workplace',         label: 'Workplace Harassment', icon: '💼', prompt: 'I am being sexually harassed at my workplace. What are my rights under the POSH Act?' },
    { id: 'cyber',             label: 'Cybercrime',         icon: '💻', prompt: 'Someone is harassing me online, sharing my photos without consent, or cyberstalking me. What legal action can I take?' },
    { id: 'assault',           label: 'Assault / Rape',     icon: '🛡️', prompt: 'I have been sexually assaulted. What are my legal rights, what charges can the accused face, and how do I file an FIR?' },
    { id: 'fir',               label: 'How to File FIR',    icon: '📁', prompt: 'How do I file an FIR? What if the police refuse to register it? Explain the process step by step.' },
    { id: 'dowry',             label: 'Dowry Harassment',   icon: '💍', prompt: 'I am being harassed for dowry by my husband or in-laws. What legal action can be taken against them?' },
    { id: 'trafficking',       label: 'Trafficking',        icon: '🔗', prompt: 'I suspect someone is being trafficked or forced into exploitation. What are the laws and who should I contact?' },
];

// ── Input sanitiser ────────────────────────────────────────────────────────────
function sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/<[^>]*>/g, '')          // strip HTML tags
        .replace(/[^\w\s.,!?'"()\-:;\n@#%&*+=/]/g, ' ') // strip unusual chars
        .replace(/\s{3,}/g, '  ')         // collapse excess whitespace
        .trim()
        .slice(0, 2000);                   // enforce max length
}

/**
 * Format real nearby safe locations (from HerShield's own database) into a
 * context block the model can reference by name/distance instead of
 * guessing. Never fabricate this list — only real, geolocated entries.
 */
function formatNearbyLocationsContext(nearbyLocations) {
    if (!Array.isArray(nearbyLocations) || nearbyLocations.length === 0) return '';
    const lines = nearbyLocations.map((loc, i) =>
        `${i + 1}. ${loc.location} (${loc.category || 'safe zone'}) — ${loc.distanceKm.toFixed(1)}km away`
    );
    return `\n\n[REAL NEARBY LOCATIONS from HerShield's database, closest first — the user's ` +
        `approximate current location matched against known safe zones. If relevant to the ` +
        `user's message, recommend from THIS list by name and distance. Do not invent any ` +
        `other specific place name:\n${lines.join('\n')}]`;
}

/**
 * Build the messages array for the Groq API.
 * history: array of { role: 'user'|'assistant', content: string }
 * We keep only the last MAX_HISTORY exchanges to stay within context limits.
 */
function buildMessages(userMessage, history, incidentContext, nearbyLocations) {
    // A topic chip (incidentContext set) always means a real legal topic was
    // chosen; otherwise classify the typed message itself.
    const useLegalPrompt = !!incidentContext || isLegalQuery(userMessage);

    let systemContent = useLegalPrompt
        ? (incidentContext
            ? `${SYSTEM_PROMPT}\n\n[CONTEXT: The user has reported a "${incidentContext}" incident on HerShield. Tailor your response to this context.]`
            : SYSTEM_PROMPT)
        : SAFETY_PROMPT;
    systemContent += formatNearbyLocationsContext(nearbyLocations);

    const recent = Array.isArray(history)
        ? history.slice(-(MAX_HISTORY * 2)) // each exchange = 2 messages
        : [];

    const safeHistory = recent
        .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
        .map(m => ({
            role:    m.role === 'assistant' ? 'assistant' : 'user',
            content: sanitizeInput(m.content),
        }));

    return [
        { role: 'system',  content: systemContent },
        ...safeHistory,
        { role: 'user',    content: sanitizeInput(userMessage) },
    ];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send a message to LexaShield and return the AI response.
 *
 * @param {string}   userMessage      The user's current message
 * @param {Array}    history          Prior { role, content } pairs (optional)
 * @param {string|null} incidentContext  e.g. 'harassment', 'stalking' (optional)
 * @param {Array|null} nearbyLocations  Real nearby safe locations: [{ location, category, distanceKm }] (optional)
 * @returns {Promise<{ content: string, model: string, tokensUsed: number }>}
 */
async function chat(userMessage, history = [], incidentContext = null, nearbyLocations = null) {
    if (!userMessage || userMessage.trim().length === 0) {
        throw Object.assign(new Error('Message cannot be empty.'), { statusCode: 400 });
    }

    const client   = getClient();
    const messages = buildMessages(userMessage, history, incidentContext, nearbyLocations);

    const completion = await client.chat.completions.create({
        model:       GROQ_MODEL,
        messages,
        max_tokens:  MAX_TOKENS,
        temperature: 0.25,   // low temperature for legal accuracy & consistency
        top_p:       0.9,
        stream:      false,
        stop:        null,
    });

    const choice = completion.choices?.[0];
    if (!choice || !choice.message?.content) {
        throw new Error('Empty response from Groq API.');
    }

    return {
        content:    choice.message.content.trim(),
        model:      completion.model,
        tokensUsed: completion.usage?.total_tokens ?? 0,
    };
}

/**
 * Returns the list of quick-start topic chips for the chat UI.
 */
function getTopics() {
    return LEGAL_TOPICS;
}

/**
 * Health check — verifies Groq API key is set and model is reachable.
 */
async function healthCheck() {
    const result = await chat('Hello, respond with "OK" only.', [], null);
    return { ok: true, model: result.model };
}

module.exports = { chat, getTopics, healthCheck };
