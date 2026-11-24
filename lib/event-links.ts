import guideDomains from "@/data/guide-domains.json";

// What an event's link says (founder, 22 Nov 2026: London's pop-ups are
// posted on Instagram and the guides link there, "thats cool"): "Tickets on"
// a ticket site, else "See it on" wherever the listing is (Instagram, a
// city guide's post, the organiser's own site).
const TICKET_SITES = /^(BookMyShow|District|Skillboxes|Eventbrite|Ticketmaster|DICE|Resident Advisor|Eventim|GoOut|Platinumlist|SISTIC|Ticketek|Klook|Shotgun|Fever|Luma|Urbanaut|Live Your City|AllEvents|Meetup)$/;

export function eventLinkLabel(site: string) {
  return `${TICKET_SITES.test(site) ? "Tickets on" : "See it on"} ${site}`;
}

// The site an event's link is on, named from the link itself (also on share
// pages, so a share's link always says where it really goes; security
// audit, 24 Nov 2026).
const KNOWN: Record<string, string> = {
    "bookmyshow.com": "BookMyShow",
    "district.in": "District",
    "skillboxes.com": "Skillboxes",
    "insider.in": "District",
    "eventbrite.com": "Eventbrite",
    "eventbrite.co.uk": "Eventbrite",
    "eventbrite.de": "Eventbrite",
    "dice.fm": "DICE",
    "ra.co": "Resident Advisor",
    "eventim.de": "Eventim",
    "goout.net": "GoOut",
    "platinumlist.net": "Platinumlist",
    "sistic.com.sg": "SISTIC",
    "timeout.com": "Time Out",
    "ticketek.com.au": "Ticketek",
    "klook.com": "Klook",
    "shotgun.live": "Shotgun",
    "urbanaut.app": "Urbanaut",
    "liveyourcity.com": "Live Your City",
    "feverup.com": "Fever",
    "lu.ma": "Luma",
    "luma.com": "Luma",
    "meetup.com": "Meetup",
    "allevents.in": "AllEvents",
    "instagram.com": "Instagram",
    "lbb.in": "LBB",
    "paris.fr": "Que faire à Paris",
    "ticketmaster.com": "Ticketmaster",
    "ticketmaster.co.uk": "Ticketmaster",
    "opentix.life": "OPENTIX",
    "whatshot.in": "WhatsHot",
};
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\.|^in\./, "");
  } catch {
    return "";
  }
};
export function siteName(url: string) {
  const host = hostOf(url);
  return KNOWN[host] ?? host;
}

// Her guide sites' own addresses (data/guide-domains.json: 354 of the 645
// guides in data/event-sites.json, matched by name and checked to exist,
// founder 24 Nov 2026: "direct search is faster and has exact events").
// A guide not here yet shows "Search it on Google" on a share page.
const GUIDES = new Set<string>(guideDomains);

// A link a share page may open (founder, 24 Nov 2026: "trusted sites only"):
// her guides and the known ticket and listing sites above, and Instagram.
// Anything else on a share shows "Search it on Google" instead, so
// a link Gemini was steered into can never reach a friend.
// Exact sites only (a "www.", "m." or "in." in front is fine), never a
// subdomain (l.instagram.com forwards anywhere), and never a link carrying
// another web address inside it, the way redirects do (security audits,
// 24 Nov 2026: Google's and Instagram's redirects).
export function trustedEventLink(url: string) {
  if (!/^https:\/\//.test(url) || carriesLink(url)) return false;
  let raw = "";
  try {
    raw = new URL(url).hostname.replace(/\.$/, "");
  } catch {
    return false;
  }
  const host = raw.replace(/^(www|m|in)\./, "");
  return host in KNOWN || GUIDES.has(host);
}

// A link with another address inside it ("?u=https://…", "/out/https://…"),
// plainly or encoded however many times; a bad encoding counts as one.
export function carriesLink(url: string) {
  const after = url.replace(/^https?:\/\/[^/?#]*/i, "");
  let text = after;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(text);
      if (next === text) break;
      text = next;
    } catch {
      return true;
    }
  }
  return /https?:|\/\/|\\|www\.|%[0-9a-f]{2}|=[a-z0-9-]+\.[a-z]{2,}(\/|$|&)/i.test(text);
}
