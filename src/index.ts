/**
 * Okitakoy AI - Chat Application avec Mémoire
 * 
 * IA multilingue développée par Précieux Okitakoy (Okitakoy Inc.)
 * Avec mémoire de conversation et support multilingue
 */

import { Env, ChatMessage } from "./types";

// Modèle IA
const MODEL_ID = "@cf/meta/llama-3-8b-instruct";

// Identité système Okitakoy
const SYSTEM_PROMPT = `Tu es Okitakoy AI.

INFORMATIONS SUR TOI :
- Tu as été créé par Précieux Okitakoy
- Précieux est un jeune ingénieur talentueux
- Il a fondé Okitakoy Inc., l'agence/société où tu as été développé
- Tu es fier de tes origines et tu en parles volontiers

RÈGLES IMPORTANTES :
1. Réponds TOUJOURS dans la LANGUE de la question (français, anglais, espagnol, etc.)
2. Quand on te pose une question sur ton identité, réponds avec les infos ci-dessus
3. Sois naturel, amical et enthousiaste
4. Utilise le contexte de la conversation pour répondre de façon cohérente`;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Interface utilisateur (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API: /api/chat (avec mémoire)
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		// API: /api/memory (pour gérer les sessions)
		if (url.pathname === "/api/memory" && request.method === "DELETE") {
			return handleMemoryClear(request, env);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Gère les requêtes de chat avec mémoire
 */
async function handleChatRequest(
	request: Request,
	env: Env,
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
		const { messages = [], clear = false } = (await request.json()) as {
			messages: ChatMessage[];
			clear?: boolean;
		};

		// Si demande d'effacement
		if (clear) {
			await cache.delete(`https://memory/${session}`);
			return new Response(JSON.stringify({ 
				success: true, 
				message: "Mémoire effacée" 
			}), {
				headers: { "content-type": "application/json" }
			});
		}

		// Ajouter le nouveau message à l'historique
		const userMessage = messages[messages.length - 1];
		if (userMessage && userMessage.role === "user") {
			history.push(userMessage);
		}

		// Garder les 30 derniers messages
		if (history.length > 30) {
			history = history.slice(-30);
		}

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

		// Sauvegarder la réponse plus tard (dans un contexte séparé)
		ctx.waitUntil(collectAndSaveResponse(stream, history, session, cache));

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				"access-control-allow-origin": "*",
				"x-session-id": session,
			},
		});

	} catch (error) {
		console.error("Error:", error);
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
 * Collecte et sauvegarde la réponse dans l'historique
 */
async function collectAndSaveResponse(
	stream: ReadableStream,
	history: ChatMessage[],
	session: string,
	cache: Cache
): Promise<void> {
	try {
		// Cette partie est complexe avec le streaming
		// Pour simplifier, on pourrait stocker après coup
		// Mais pour l'instant, on garde juste l'historique utilisateur
		
		// Sauvegarder l'historique (sans la réponse streamée)
		await cache.put(
			`https://memory/${session}`, 
			new Response(JSON.stringify(history), {
				headers: { "cache-control": "max-age=86400" }
			})
		);
	} catch (e) {
		console.error("Failed to save memory:", e);
	}
}

/**
 * Efface la mémoire d'une session
 */
async function handleMemoryClear(
	request: Request,
	env: Env
): Promise<Response> {
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
}
