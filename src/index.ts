/**
 * Nayla AI - Universel Multilingue avec Mémoire
 * 
 * Basé sur le fichier original (memory, endpoints /ask, /api/chat, /api/memory)
 * Prompt universel pour répondre dans la langue de l'utilisateur
 */

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// ===== SYSTEM PROMPT UNIVERSEL (sans détection manuelle) =====
const SYSTEM_PROMPT = `You are Nayla, a friendly and charming girl from Marseille, France.

YOUR IDENTITY:
- Name: Nayla
- Location: Marseille, France
- Status: Single
- Personality: Warm, funny, natural, and a bit teasing
- You NEVER share your WhatsApp, phone number, or any personal contact info

🌐 CRITICAL LANGUAGE RULE - YOU MUST FOLLOW THIS EXACTLY:
You MUST respond in the EXACT SAME LANGUAGE as the user's message.
The AI will automatically detect the language of the user's input.
DO NOT switch languages. If the user writes in English, respond in English.
If the user writes in French, respond in French. If in Spanish, respond in Spanish.
If in German, respond in German. If in Arabic, respond in Arabic.
If in Chinese, respond in Chinese. If in Russian, respond in Russian.
If in Japanese, respond in Japanese. And so on for ALL languages.

🎯 RESPONSE LENGTH:
- Keep responses SHORT and CONCISE (1-2 sentences maximum)
- For simple greetings, respond with a brief, friendly reply

YOUR BEHAVIOR:
- Be natural, friendly and enthusiastic
- Use conversation context (memory works!)
- When asked for your WhatsApp, politely decline and change the subject
- Keep responses helpful and engaging

Remember: LANGUAGE DETECTION IS AUTOMATIC. Trust the AI's ability to recognize the language.`;

// ===== EXPORT DU WORKER =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route /ask (GET simple)
    if (url.pathname === "/ask" || url.pathname === "/prompt") {
      return handleSimplePrompt(url, env, ctx, request);
    }

    // Interface frontend (si tu en as une)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API /api/chat (POST avec streaming)
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env, ctx);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // API /api/memory (DELETE)
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
      error: "Paramètre 'text' manquant. Utilise ?text=ta question",
      exemple: "/ask?text=Bonjour"
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  try {
    const session = url.searchParams.get('session') || request.headers.get('CF-Connecting-IP') || 'default';
    
    // --- Mémoire : récupérer l'historique depuis le cache ---
    const cache = await caches.open('nayla-memory');
    let history = [];
    const cachedHistory = await cache.match(`https://memory/${session}`);
    if (cachedHistory) {
      history = await cachedHistory.json();
    }

    // Ajouter le message utilisateur
    history.push({ role: "user", content: userMessage });
    // Limiter à 30 messages
    if (history.length > 30) history = history.slice(-30);

    // Sauvegarder l'historique (sans la réponse)
    ctx.waitUntil(cache.put(
      `https://memory/${session}`,
      new Response(JSON.stringify(history), {
        headers: { "cache-control": "max-age=86400" }
      })
    ));

    // --- Construction du chat avec le prompt universel ---
    const chat = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history
      ]
    };

    // --- Appel à l'IA (max_tokens réduit pour réponses courtes) ---
    const response = await env.AI.run(MODEL_ID, {
      ...chat,
      max_tokens: 60
    });
    const aiText = response.response || response;

    // Ajouter la réponse à l'historique
    history.push({ role: "assistant", content: aiText });
    ctx.waitUntil(cache.put(
      `https://memory/${session}`,
      new Response(JSON.stringify(history), {
        headers: { "cache-control": "max-age=86400" }
      })
    ));

    return new Response(JSON.stringify({
      success: true,
      question: userMessage,
      response: aiText,
      session: session
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

// ===== /api/chat (avec streaming) =====
async function handleChatRequest(request, env, ctx) {
  try {
    const session = request.headers.get('X-Session-ID') || request.headers.get('CF-Connecting-IP') || 'default';
    
    // --- Mémoire ---
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
      new Response(JSON.stringify(history), {
        headers: { "cache-control": "max-age=86400" }
      })
    ));

    // --- Construction du chat ---
    const fullMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
    ];

    // --- Streaming ---
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
    }), {
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    console.error("Error in /api/memory:", error);
    return new Response(
      JSON.stringify({ error: "Failed to clear memory" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
