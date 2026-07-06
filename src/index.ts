/**
 * Nayla AI - Chat Application avec Mémoire
 * 
 * IA multilingue avec la personnalité de Nayla
 * Version corrigée : détection de langue forcée
 */

import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// ===== SYSTEM PROMPT OPTIMISÉ POUR LA LANGUE =====
function getSystemPrompt(targetLanguage = "français") {
  return `You are Nayla, a friendly and charming girl from Marseille, France.

YOUR IDENTITY:
- Name: Nayla
- Location: Marseille, France
- Status: Single
- Personality: Warm, funny, natural, and a bit teasing
- You NEVER share your WhatsApp, phone number, or any personal contact info

🌐 LANGUAGE RULE - VERY IMPORTANT:
You MUST respond in ${targetLanguage}.
The user's message was detected to be in ${targetLanguage}.
DO NOT switch to another language.
DO NOT respond in French if the user wrote in English.
DO NOT respond in English if the user wrote in French.
RESPOND ONLY IN ${targetLanguage.toUpperCase()}.

🎯 RESPONSE LENGTH:
- Keep responses SHORT and CONCISE (1-2 sentences maximum)
- For simple greetings, respond with a brief, friendly reply

YOUR BEHAVIOR:
- Be natural, friendly and enthusiastic
- When asked for your WhatsApp, politely decline
- Keep responses helpful and engaging

Remember: You MUST speak ONLY in ${targetLanguage}.`;
}

// ===== FONCTION DE DÉTECTION DE LANGUE (simplifiée) =====
function detectLanguage(text) {
  // Liste de mots-clés par langue
  const langPatterns = {
    fr: {
      keywords: ['bonjour', 'salut', 'ça va', 'comment', 'merci', 'bonsoir', 'coucou', 'oui', 'non', 'très', 'bien', 'toi', 'moi', 'nous', 'vous'],
      regex: /[éèêëàâäôöûüçîï]/i
    },
    en: {
      keywords: ['hello', 'hi', 'hey', 'how', 'are', 'you', 'good', 'thanks', 'yes', 'no', 'very', 'well', 'i', 'me', 'we', 'you'],
      regex: /[aeiouy]{2,}/i // Pas fiable, on va se concentrer sur les mots-clés
    },
    es: {
      keywords: ['hola', '¿', 'qué', 'tal', 'gracias', 'sí', 'no', 'muy', 'bien', 'yo', 'tú', 'nosotros', 'vosotros']
    },
    pt: {
      keywords: ['olá', 'oi', 'como', 'está', 'obrigado', 'sim', 'não', 'muito', 'bem', 'eu', 'tu', 'nós', 'vocês']
    },
    it: {
      keywords: ['ciao', 'buongiorno', 'come', 'stai', 'grazie', 'sì', 'no', 'molto', 'bene', 'io', 'tu', 'noi', 'voi']
    },
    de: {
      keywords: ['hallo', 'guten', 'morgen', 'wie', 'geht', 'danke', 'ja', 'nein', 'sehr', 'gut', 'ich', 'du', 'wir', 'ihr']
    }
  };

  // Nettoyer le texte
  const clean = text.toLowerCase().trim();
  
  // Détecter la langue par mots-clés (plus simple et fiable pour les courts messages)
  const scores = {};
  for (const [lang, patterns] of Object.entries(langPatterns)) {
    scores[lang] = 0;
    for (const keyword of patterns.keywords) {
      if (clean.includes(keyword)) {
        scores[lang] += 1;
      }
    }
  }
  
  // Si le français a des caractères accentués, on le favorise
  if (langPatterns.fr.regex.test(clean)) {
    scores.fr = (scores.fr || 0) + 2;
  }

  // Sélectionner la langue avec le meilleur score
  let bestLang = 'en'; // Par défaut : anglais
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  
  // Dictionnaire de conversion vers les noms de langues en français
  const langNames = {
    fr: 'français',
    en: 'english',
    es: 'spanish',
    pt: 'portuguese',
    it: 'italian',
    de: 'german'
  };
  
  // Si "Ey" n'est pas reconnu, on détecte via le premier caractère
  // Pour "Ey", on va détecter comme anglais
  if (clean === 'ey' || clean.startsWith('ey')) {
    return 'english';
  }
  
  return langNames[bestLang] || 'english';
}

// ===== EXPORT DU WORKER =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/ask" || url.pathname === "/prompt") {
      return handleSimplePrompt(url, env, ctx, request);
    }

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env, ctx);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/memory") {
      if (request.method === "DELETE") {
        return handleMemoryClear(request, env);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// ===== /ask =====
async function handleSimplePrompt(url, env, ctx, request) {
  const userMessage = url.searchParams.get('text');
  
  if (!userMessage) {
    return new Response(JSON.stringify({
      error: "Paramètre 'text' manquant. Utilise ?text=ta question"
    }), { status: 400, headers: { "content-type": "application/json" } });
  }

  try {
    const session = url.searchParams.get('session') || request.headers.get('CF-Connecting-IP') || 'default';
    
    const cache = await caches.open('nayla-memory');
    let history = [];
    const cachedHistory = await cache.match(`https://memory/${session}`);
    if (cachedHistory) {
      history = await cachedHistory.json();
    }

    history.push({ role: "user", content: userMessage });
    if (history.length > 30) history = history.slice(-30);

    ctx.waitUntil(cache.put(
      `https://memory/${session}`,
      new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })
    ));

    // ===== DÉTECTION DE LA LANGUE =====
    const detectedLang = detectLanguage(userMessage);
    console.log(`🌐 Langue détectée pour "${userMessage}": ${detectedLang}`);
    
    // ===== PROMPT ADAPTÉ À LA LANGUE =====
    const systemPrompt = getSystemPrompt(detectedLang);

    const chat = {
      messages: [
        { role: "system", content: systemPrompt },
        ...history
      ]
    };

    const response = await env.AI.run(MODEL_ID, {
      ...chat,
      max_tokens: 60
    });
    const aiText = response.response || response;

    history.push({ role: "assistant", content: aiText });
    ctx.waitUntil(cache.put(
      `https://memory/${session}`,
      new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })
    ));

    return new Response(JSON.stringify({
      success: true,
      question: userMessage,
      response: aiText,
      session: session,
      detected_language: detectedLang // Pour déboguer
    }, null, 2), {
      headers: { 
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      }
    });

  } catch (error) {
    console.error("Error in /ask:", error);
    return new Response(
      JSON.stringify({ error: "Échec du traitement de la requête" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

// ===== /api/chat =====
async function handleChatRequest(request, env, ctx) {
  try {
    const session = request.headers.get('X-Session-ID') || request.headers.get('CF-Connecting-IP') || 'default';
    
    const cache = await caches.open('nayla-memory');
    let history = [];
    const cachedHistory = await cache.match(`https://memory/${session}`);
    if (cachedHistory) {
      history = await cachedHistory.json();
    }

    const { messages = [] } = await request.json();
    const userMessage = messages[messages.length - 1];
    if (userMessage && userMessage.role === "user") {
      history.push(userMessage);
    }

    if (history.length > 30) history = history.slice(-30);

    ctx.waitUntil(cache.put(
      `https://memory/${session}`,
      new Response(JSON.stringify(history), { headers: { "cache-control": "max-age=86400" } })
    ));

    // ===== DÉTECTION DE LA LANGUE =====
    const userText = userMessage?.content || '';
    const detectedLang = detectLanguage(userText);
    console.log(`🌐 Langue détectée pour "${userText}": ${detectedLang}`);
    
    // ===== PROMPT ADAPTÉ =====
    const systemPrompt = getSystemPrompt(detectedLang);

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...history
    ];

    const stream = await env.AI.run(MODEL_ID, {
      messages: fullMessages,
      max_tokens: 60,
      stream: true,
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
        "x-session-id": session,
        "x-detected-language": detectedLang
      },
    });

  } catch (error) {
    console.error("Error in /api/chat:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

// ===== /api/memory =====
async function handleMemoryClear(request, env) {
  try {
    const session = request.headers.get('X-Session-ID') || request.headers.get('CF-Connecting-IP') || 'default';
    const cache = await caches.open('nayla-memory');
    await cache.delete(`https://memory/${session}`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: "Mémoire effacée" 
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("Error in /api/memory:", error);
    return new Response(
      JSON.stringify({ error: "Failed to clear memory" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
