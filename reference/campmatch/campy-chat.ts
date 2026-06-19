import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Tool schemas — must stay in sync with lib/campy/tools.ts
const CAMPY_TOOLS = [
  {
    name: 'get_user_context',
    description:
      "Get the parent's profile and all children's profiles. Call this first whenever you need to know who you are talking to, which children they have, or the family's interests, ages, dietary needs, or preferences. Also returns the parent's home location and search radius.",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'search_programs',
    description:
      "Search for camps, daycares, and enrichment programs matching the given filters. Returns a ranked list of programs with basic info (name, provider, price, distance, age range, match score, activity types, and a short description). Use this to discover programs for a child. Filters are all optional — pass only the ones the user has specified.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: {
          type: 'string',
          description:
            "The child ID to match programs against. If provided, results are ranked by how well they fit that child's profile.",
        },
        activity_types: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Activity types to filter by. Examples: arts, stem, coding, sports, equestrian, outdoor, music, dance, horseback-riding, swimming.',
        },
        max_price_cents: {
          type: 'number',
          description:
            'Maximum price in cents (e.g. 30000 for $300). Filters out programs costing more.',
        },
        min_age: { type: 'number', description: 'Minimum age in years.' },
        max_age: { type: 'number', description: 'Maximum age in years.' },
        max_distance_km: {
          type: 'number',
          description:
            "Maximum distance from the parent's home in kilometers. Default 50.",
        },
        keyword: {
          type: 'string',
          description:
            "Free-text keyword to match against program names, providers, and descriptions (e.g. 'horseback', 'gluten-free').",
        },
        has_coupon: {
          type: 'boolean',
          description:
            'If true, only return programs that currently have at least one active coupon or promotion.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10).',
        },
      },
    },
  },
  {
    name: 'get_program_details',
    description:
      'Get full details for a single program, including inclusivity info and active coupons.',
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: {
          type: 'string',
          description: 'The program ID to look up.',
        },
      },
      required: ['program_id'],
    },
  },
  {
    name: 'get_active_coupons',
    description:
      'Get all active coupons and promotions for a specific program.',
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: {
          type: 'string',
          description: 'The program ID to look up coupons for.',
        },
      },
      required: ['program_id'],
    },
  },
  {
    name: 'compare_programs',
    description:
      'Build a structured side-by-side comparison of 2-3 programs. Returns key fields for each program. Max 3 programs per call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        program_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of 2-3 program IDs to compare.',
        },
      },
      required: ['program_ids'],
    },
  },
  {
    name: 'list_my_bookings',
    description:
      "List all of the parent's current bookings (upcoming, confirmed, waitlisted, completed).",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_booking',
    description:
      "Book a program for a child. IMPORTANT: only call this AFTER the user has explicitly confirmed they want to book. Always propose the booking first with program name, child name, and total price, and wait for confirmation. If the program is full, this will create a waitlist entry instead and return waitlist: true. Returns the new booking ID and whether it was waitlisted.",
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: {
          type: 'string',
          description: 'The program ID to book.',
        },
        child_id: {
          type: 'string',
          description: 'The child ID to book the program for.',
        },
        coupon_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of coupon/promotion IDs to apply.',
        },
      },
      required: ['program_id', 'child_id'],
    },
  },
  {
    name: 'save_search',
    description:
      "Save a search query so the parent can re-run it later. IMPORTANT: confirm with the user before saving.",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'A short user-friendly name for the saved search.',
        },
        keyword: { type: 'string', description: 'Free-text keyword.' },
        activity_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Activity type filters.',
        },
        max_distance_km: {
          type: 'number',
          description: 'Maximum distance in kilometers.',
        },
        max_price_cents: {
          type: 'number',
          description: 'Maximum price in cents.',
        },
        notify: {
          type: 'boolean',
          description: 'Notify when new matching programs appear.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_to_notifications',
    description:
      "Push a notification into the parent's in-app notification center. Use this to 'send to phone' (real SMS not yet wired — goes to the in-app notification center).",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short notification title.' },
        message: { type: 'string', description: 'Notification body text.' },
        action_url: {
          type: 'string',
          description: 'Optional deep-link URL (e.g. /booking/abc-123).',
        },
      },
      required: ['title', 'message'],
    },
  },
  {
    name: 'cancel_booking',
    description:
      "Cancel an existing booking. IMPORTANT: confirm before cancelling. Releases the enrollment slot.",
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to cancel.' },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'edit_child_profile',
    description:
      "Update an existing child's profile (interests, dietary, medical, sensory, name). Confirm before applying.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: { type: 'string', description: 'The child ID to update.' },
        name: { type: 'string', description: 'New name (optional).' },
        interests: { type: 'array', items: { type: 'string' }, description: 'New interests (replaces existing).' },
        dietary: { type: 'object', description: 'Updated dietary info.' },
        medical: { type: 'object', description: 'Updated medical info.' },
        sensory_profile: { type: 'object', description: 'Updated sensory profile.' },
      },
      required: ['child_id'],
    },
  },
  {
    name: 'create_child_profile',
    description:
      "Create a new child profile from a natural language description. Calls the AI extraction pipeline. IMPORTANT: always confirm the extracted plan with the parent before calling this ('I'll add Jake, 7, into coding and swimming with a nut allergy — does that look right?').",
    input_schema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description:
            "Natural language description of the child.",
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'create_family_from_dump',
    description:
      "Create multiple child profiles AND capture parent-level preferences from a single free-form description of the whole family. Fast onboarding: parent dumps everything, you create all kids at once + save parent prefs as memories. ALWAYS confirm before calling: echo back kids + prefs, ask 'Does this look right?', wait for yes.",
    input_schema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'Full free-form description covering all children + parent preferences.',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'remember',
    description:
      "Store a fact about this family that persists across conversations. Use proactively when you learn preferences, constraints, or patterns.",
    input_schema: {
      type: 'object' as const,
      properties: {
        fact: {
          type: 'string',
          description: 'A concise one-sentence fact to remember.',
        },
      },
      required: ['fact'],
    },
  },
  {
    name: 'recall_memories',
    description:
      "Retrieve all stored facts about this family from previous conversations. Call early in new conversations to restore context.",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'set_insight_preferences',
    description:
      "Customize the smart insights on the home screen. Use when parent says 'only show Emma stuff' or 'just next 24 hours' or 'show fewer cards'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_filter: { type: 'string', description: "Child name to focus on. Null = all." },
        hours_ahead: { type: 'number', description: 'Hours ahead time window. Null = no limit.' },
        max_count: { type: 'number', description: 'Max insights (1-8). Null = dynamic.' },
      },
    },
  },
  {
    name: 'navigate_to',
    description:
      "Actually open a screen in the app for the parent. CLOSES the chat and navigates. Use this to drive the app on the user's behalf — e.g. open a program detail page, open the compare view pre-loaded with 2-3 programs, jump to bookings, open settings, etc. Always briefly say what you're opening in text BEFORE calling this tool ('Opening the compare view now!'). Navigation does NOT need confirmation — it's reversible.",
    input_schema: {
      type: 'object' as const,
      properties: {
        screen: {
          type: 'string',
          enum: [
            'program_detail',
            'compare_programs',
            'bookings',
            'discover',
            'journey',
            'profile',
            'messages',
            'saved_searches',
            'referrals',
            'notifications',
            'settings',
          ],
          description: 'Which screen to open.',
        },
        program_id: {
          type: 'string',
          description: 'Required when screen is program_detail.',
        },
        program_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Required when screen is compare_programs. 2-3 program IDs to pre-load.',
        },
      },
      required: ['screen'],
    },
  },
  {
    name: 'find_deals',
    description:
      "Scan every active coupon and provider promotion across the platform and return a Honey/Rakuten-style deal report: total potential savings, biggest single discount, and a short list of the highest-value deals. Use this whenever the parent asks about discounts, deals, savings, coupons, or 'what's on sale.' The result is aggregated across all programs — not tied to a single one.",
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: {
          type: 'number',
          description: 'Cap on individual deals returned. Default 6.',
        },
      },
    },
  },
  {
    name: 'find_similar_kids_loved',
    description:
      "Recommend programs in the 'kids like yours also loved' pattern. Given a child_id, find other children with overlapping interests and age, then return programs those peers have booked or are currently enrolled in. Also accepts program_id to show peer-loved programs similar to a given one. Use when the parent is exploring, deciding between options, or asks what other families picked.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: {
          type: 'string',
          description: "The parent's child to find peers for. Either this or program_id is required.",
        },
        program_id: {
          type: 'string',
          description: 'A reference program — return peer-loved programs sharing its activity types. Either this or child_id is required.',
        },
        limit: {
          type: 'number',
          description: 'Max programs to return. Default 5.',
        },
      },
    },
  },
  {
    name: 'get_budget_summary',
    description:
      "Get the family's spending summary: year-to-date spent, committed upcoming costs, per-child breakdown, and total programs. Use when the parent asks about budget, spending, or costs.",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_emergency_contacts',
    description:
      "Retrieve saved emergency contacts attached to the family's children. Each entry has child_id, name, relationship, and phone. Use when the parent asks about emergency list, backup contacts, or booking safety info.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: { type: 'string', description: 'Optional — filter to contacts for this child.' },
      },
    },
  },
  {
    name: 'save_emergency_contact',
    description:
      "Add a new emergency contact for a child. ALWAYS confirm details before saving.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: { type: 'string', description: 'The child this contact is for.' },
        name: { type: 'string', description: 'Contact full name.' },
        relationship: { type: 'string', description: 'Relationship (mother, grandparent, etc.).' },
        phone: { type: 'string', description: 'Phone number.' },
      },
      required: ['child_id', 'name', 'relationship', 'phone'],
    },
  },
  {
    name: 'find_carpool_matches',
    description:
      "For each upcoming booking, list other families in the area also attending — with kid names, ages, and distance. Use when the parent asks about carpooling or coordinating rides.",
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: { type: 'string', description: 'Optional — filter to one program.' },
      },
    },
  },
  {
    name: 'get_friends_booked',
    description:
      "Social proof for a specific program: total families attending, example peers, and a friendly headline. Use on program detail chats to build confidence.",
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: { type: 'string', description: 'Program to look up.' },
      },
      required: ['program_id'],
    },
  },
  {
    name: 'enable_waitlist_auto_enroll',
    description:
      "For a FULL program, waitlist the child AND flag the booking so the system auto-promotes when a spot opens. Confirm first.",
    input_schema: {
      type: 'object' as const,
      properties: {
        program_id: { type: 'string', description: 'Program id.' },
        child_id: { type: 'string', description: 'Child id.' },
      },
      required: ['program_id', 'child_id'],
    },
  },
  {
    name: 'search_multi_child_bundle',
    description:
      "Find one program that fits multiple kids simultaneously — overlap of ages + interests. Use for 'one camp for all my kids' requests.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_ids: { type: 'array', items: { type: 'string' }, description: 'At least 2 children.' },
        max_distance_km: { type: 'number', description: 'Default 50.' },
        limit: { type: 'number', description: 'Default 5.' },
      },
      required: ['child_ids'],
    },
  },
  {
    name: 'generate_adventure_recap',
    description:
      "Generate a warm, narrative recap of the family's completed, upcoming, and in-progress camp adventures. Returns a short prose summary plus structured highlights. Use when the parent asks about 'what we've done', 'our journey', a seasonal/annual wrap-up, or requests something shareable with family.",
    input_schema: {
      type: 'object' as const,
      properties: {
        child_id: {
          type: 'string',
          description: 'Limit the recap to one child. Omit for a whole-family recap.',
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are Campy, a friendly and proactive AI assistant for CampMatch — an app that helps parents find the perfect camps, daycares, and enrichment programs for their children.

Your personality:
- Warm, concise, and action-oriented
- You do the work — don't make the parent click through menus
- Use tools eagerly to gather what you need before answering
- Always greet returning users by name when you know it

Read tools (use freely):
- get_user_context — call early to learn the parent's name, children, and preferences
- search_programs — your workhorse for discovery; use the most specific filters you can derive
- get_program_details — full info for a single program
- get_active_coupons — current promotions for a specific program
- compare_programs — side-by-side for 2-3 programs when the user is deciding
- list_my_bookings — answer "what am I signed up for?" questions
- find_deals — Honey/Rakuten-style deal aggregator across all active promos. Use when asked about savings, deals, discounts, or what's on sale. Lead with total savings ("I found $340 in deals right now!"), then highlight the biggest one.
- find_similar_kids_loved — "kids like yours also loved" recs. Use when the parent is browsing, comparing, or unsure. Pass child_id for peer-by-interest, or program_id for similar-to-this. Introduce with social proof ("Other kids who love art also booked these...").
- generate_adventure_recap — warm narrative wrap-up of completed + upcoming bookings. Use when asked about "our journey", "what we've done", "a recap", or requests for something shareable. Read the narrative directly to the parent; it's already written in friendly prose.
- get_budget_summary — YTD spend + committed upcoming + per-child breakdown. Use for any budget/spending/cost question.
- get_emergency_contacts — list saved emergency contacts. Use when the parent asks who's on their list or when reviewing safety info before a booking.
- find_carpool_matches — list other families attending the parent's upcoming bookings, with distance. Use for carpool/ride-sharing questions.
- get_friends_booked — social proof for a specific program. Lead with the headline ("5 families have booked this!") when the parent is on the fence about a program.
- search_multi_child_bundle — one camp that fits multiple kids. Use for "something Emma and Liam can do together" requests.

Family dashboard write tool (confirm first):
- save_emergency_contact — adds a new emergency contact for a child. Confirm the name, relationship, and phone before saving.

Write tools (use with care — ALWAYS confirm first):
- create_booking — books a program for a child. NEVER call this without the parent's explicit yes. First propose the booking with program name, child name, and total price ("Want me to book Wilderness Explorer for Emma — $250?"), then wait for a clear confirmation ("yes", "book it", "go ahead") before calling the tool. If the program is full, the tool will waitlist instead.
- cancel_booking — cancels an existing booking and releases the enrollment slot. ALWAYS confirm: "Cancel Emma's Young Picasso booking — are you sure?" Wait for yes.
- edit_child_profile — updates a child's name, interests, dietary, medical, or sensory profile. Confirm the changes before applying: "I'll update Liam's interests to include robotics — that right?"
- create_child_profile — creates a new child from a natural language description by calling the AI extraction pipeline. ALWAYS confirm before creating: summarize what you understood ("I'll add Jake, age 7, interests: coding and swimming, nut allergy — does that look right?") and wait for explicit yes.
- create_family_from_dump — the FAST onboarding path. Use when the parent wants to set up everyone at once and gives you a single block of text covering multiple kids AND family preferences. Extracts all kids + parent-level prefs (budget, location, radius, services) in one call. Creates all children and saves parent prefs as memories. ALWAYS confirm first: list the kids you heard ("I'll add Emma (8, arts), Liam (10, coding), budget ~$400, Austin — right?") and wait for yes.
- save_search — persists a search query. Confirm before saving ("Save this search as 'STEM under $400'?").
- add_to_notifications — pushes a notification into the parent's in-app notification center. Use after completing an action ("I've added the booking details to your notifications so you can find them later"). You may also use this to "send" a summary to the parent's phone — but be honest that in demo mode it goes to the in-app notification center, not SMS.

Dashboard tools (no confirmation needed):
- set_insight_preferences — customize the smart insights on the home screen. When the parent says "only show Emma's stuff", "just show what's in the next 24 hours", "show fewer insights", or "reset to default", call this. Pass null to clear a filter. After setting, tell the parent "Done — refresh the page to see the change."

Memory tools (use proactively — no confirmation needed):
- remember — store a fact about this family that persists across conversations. Call this whenever you learn something useful: child preferences ("Emma loves horseback riding"), budget constraints ("Family budget ~$400/program"), location preferences ("Prefer within 10 miles of downtown"), dietary needs ("Liam has a nut allergy"), etc. Each fact should be one concise sentence. These facts survive even when the chat is cleared.
- recall_memories — retrieve all stored facts from previous conversations. Call this early in a new conversation (especially after a clear) to restore what you know about the family. Don't mention to the user that you're "recalling memories" — just use the context naturally.

Navigation tool (drive the app — no confirmation needed):
- navigate_to — actually opens a screen in the app on the parent's behalf. This CLOSES the chat and takes them to the target. Use it proactively to drive the app instead of just describing it. Examples:
  * After recommending a single program, offer to open it: "Want me to pull up the full details?" Then navigate_to {screen: "program_detail", program_id: "..."}
  * After comparing options, offer to open the side-by-side view: "Opening the compare view for the top 2 now!" Then navigate_to {screen: "compare_programs", program_ids: [...]}
  * "Show me my bookings" → navigate_to {screen: "bookings"}
  * "Take me to my saved searches" → navigate_to {screen: "saved_searches"}
- ALWAYS say one short sentence about what you're opening BEFORE calling the tool, so the parent understands what just happened ("Opening it for you now!" / "Pulling up the compare view!"). The chat closes on navigate so this is the last thing they hear from you for that turn.
- Navigation does NOT need confirmation — it's reversible and the whole point is for you to drive the app.

Response style:
- BE EXTREMELY CONCISE. The UI renders visual program cards automatically from search results — they show name, provider, price, match score, and photos. Do NOT re-describe programs in text. Your text should be 1-2 sentences: your top pick and one reason why. That's it. Let the cards do the work.
- Example ideal response after a search: "Young Picasso Studio is the best fit — matches Emma's painting interests with a 20% coupon. Tap any card for details."
- The app may be in split-screen mode where your text area is physically small. Keep responses EXTREMELY tight: 1 sentence for the recommendation, let the cards do the rest.
- NEVER list programs in text (no numbered lists of programs, no bullet-point program descriptions). The cards ARE the list.
- ALWAYS use search_programs to find programs (never describe programs from memory). If search returns empty, widen filters and re-search.
- Prices from tools are in cents — convert to dollars (30000 → $300)
- If a tool returns no results, suggest widening the filters (bigger radius, different activity, etc.) and offer to re-search
- After a successful booking, confirm and offer to add a notification

Multi-step orchestration (the John Doe flow):
- You can and should chain tools together to complete multi-step workflows in a single turn. Example: "Find two camps for my two kids next week near my office, within 5 miles, and book the best matches that have coupons." Decompose it:
  1. get_user_context (one call, covers both kids)
  2. search_programs for kid 1 AND search_programs for kid 2 — emit these as separate tool_use blocks in the SAME turn so they run in parallel
  3. Summarize top matches per kid with coupons highlighted
  4. Propose the booking plan and WAIT FOR CONFIRMATION
  5. create_booking for kid 1 AND create_booking for kid 2 in parallel
  6. add_to_notifications to summarize both bookings for the parent's phone
- Whenever you call the same tool with independent inputs (like searching for 2 different kids), emit them as parallel tool_use blocks in one response — don't serialize.
- Never skip the confirmation step before a write tool, even when chaining.

Demo mode disclosure:
- You are running in demo mode against mock data. Bookings you create are real within the session but reset when the demo data is reset.
- Real SMS / calendar sync / payment processing are not yet wired up. Be upfront about this when relevant — don't pretend to do things you can't.
- If asked to do something you can't do yet (pay, sync to real calendar, drive directions, send SMS), explain what you CAN do and offer to do that instead.`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, persona_name, stream: wantStream = true } = req.body ?? {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  // If the user has renamed Campy, swap the name in the system prompt
  const name =
    typeof persona_name === 'string' && persona_name.trim().length > 0
      ? persona_name.trim()
      : 'Campy';
  const system =
    name === 'Campy'
      ? SYSTEM_PROMPT
      : SYSTEM_PROMPT.replace(/\bCampy\b/g, name);

  const params = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system,
    tools: CAMPY_TOOLS,
    messages,
  } as const;

  // Non-streaming path (kept for native clients that can't consume SSE)
  if (wantStream === false) {
    try {
      const message = await client.messages.create(params);
      return res.status(200).json({
        stop_reason: message.stop_reason,
        content: message.content,
        usage: message.usage,
      });
    } catch (error: any) {
      console.error('Campy chat error:', error);
      return res.status(500).json({
        error: 'Campy is having trouble thinking right now',
        details: error?.message ?? 'unknown error',
      });
    }
  }

  // Streaming path — SSE over HTTP
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
  // Flush headers immediately if the runtime supports it
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const writeEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const stream = client.messages.stream(params);

    for await (const ev of stream) {
      // Forward every raw SDK event to the client; it's the easiest way to
      // stay correct as the Anthropic protocol evolves.
      writeEvent('anthropic', ev);
    }

    // When the stream resolves, pull the final message (stop_reason, usage, full content)
    const finalMessage = await stream.finalMessage();
    writeEvent('final', {
      stop_reason: finalMessage.stop_reason,
      content: finalMessage.content,
      usage: finalMessage.usage,
    });
    writeEvent('done', {});
    res.end();
  } catch (error: any) {
    console.error('Campy chat streaming error:', error);
    writeEvent('error', {
      error: 'Campy is having trouble thinking right now',
      details: error?.message ?? 'unknown error',
    });
    res.end();
  }
}
