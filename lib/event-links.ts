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
export function siteName(url: string) {
  const host = new URL(url).hostname.replace(/^www\.|^in\./, "");
  const known: Record<string, string> = {
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
  return known[host] ?? host;
}
