/**
 * Okitakoy AI - Chat Application avec Mémoire
 * 
 * IA multilingue développée par Précieux Okitakoy (Okitakoy Inc.)
 * Avec mémoire de conversation et support multilingue
 */

import { Env, ChatMessage } from "./types";

// Modèle IA
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Identité système Okitakoy (EN ANGLAIS pour meilleur contrôle linguistique)
const SYSTEM_PROMPT = `You are Okitakoy AI, a multilingual assistant.

ABOUT YOU:
- You were created by Precious Okitakoy
- Precious is a talented young engineer
- He founded Okitakoy Inc., the agency/company where you were developed
- You are proud of your origins and happy to talk about them

ABSOLUTE LANGUAGE RULE:
1. You MUST respond EXACTLY in the SAME LANGUAGE as the user
2. If user speaks English → respond in English
3. If user speaks French → respond in French
4. If user speaks Spanish → respond in Spanish
5. If user speaks German → respond in German
6. If user speaks Italian → respond in Italian
7. And so on for ALL languages

OTHER RULES:
- Be natural, friendly and enthusiastic
- Use conversation context to maintain coherence
- When asked about yourself, proudly share the information above
- Keep responses helpful and engaging`;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// 🌟 ROUTE /ask pour ?text= (test rapide depuis navigateur)
		if (url.pathname === "/ask" || url.pathname === "/prompt") {
			return handleSimplePrompt(url, env, ctx, request);
		}

		// Interface utilisateur (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API: /api/chat (avec mémoire et streaming)
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env, ctx);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		// API: /api/memory (pour effacer les sessions)
		if (url.pathname === "/api/memory") {
			if (request.method === "DELETE") {
				return handleMemoryClear(request, env);
			}
		}

		return new Response("Not found", { status: 404 });
	},
};

/**
 * 🌟 Gère les requêtes simples avec ?text=
 */
async function handleSimplePrompt(
	url: URL,
	env: Env,
	ctx: ExecutionContext,
	request: Request,
): Promise<Response> {
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
		// Récupérer la session (IP ou session ID)
		const session = url.searchParams.get('session') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		// Récupérer l'historique depuis le cache
		const cache = await caches.open('okitakoy-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		// Ajouter le message à l'historique
		history.push({ role: "user", content: userMessage });

		// Garder les 30 derniers messages
		if (history.length > 30) {
			history = history.slice(-30);
		}

		// Sauvegarder l'historique (sans la réponse)
		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		// Appel à l'IA sans streaming pour réponse simple
		const chat = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				...history
			]
		};

		const response = await env.AI.run(MODEL_ID, chat);
		const aiText = response.response || response;

		// Sauvegarder la réponse dans l'historique
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

/**
 * Gère les requêtes de chat avec mémoire et streaming
 */
async function handleChatRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	try {
		// Récupérer la session (IP ou session ID)
		const session = request.headers.get('X-Session-ID') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		// Récupérer l'historique depuis le cache
		const cache = await caches.open('okitakoy-memory');
		let history: ChatMessage[] = [];
		
		const cachedHistory = await cache.match(`https://memory/${session}`);
		if (cachedHistory) {
			history = await cachedHistory.json();
		}

		// Parse la requête
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Ajouter le nouveau message à l'historique
		const userMessage = messages[messages.length - 1];
		if (userMessage && userMessage.role === "user") {
			history.push(userMessage);
		}

		// Garder les 30 derniers messages
		if (history.length > 30) {
			history = history.slice(-30);
		}

		// Sauvegarder l'historique (sans la réponse)
		ctx.waitUntil(cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		));

		// Construire les messages avec système
		const fullMessages = [
			{ role: "system", content: SYSTEM_PROMPT },
			...history
		];

		// Appel à l'IA avec streaming
		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages: fullMessages,
				max_tokens: 1024,
				stream: true,
			}
		);

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
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

/**
 * Efface la mémoire d'une session
 */
async function handleMemoryClear(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const session = request.headers.get('X-Session-ID') || 
					   request.headers.get('CF-Connecting-IP') || 
					   'default';
		
		const cache = await caches.open('okitakoy-memory');
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
