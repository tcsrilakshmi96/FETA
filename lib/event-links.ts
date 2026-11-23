// What an event's link says (founder, 22 Nov 2026: London's pop-ups are
// posted on Instagram and the guides link there, "thats cool"): "Tickets on"
// a ticket site, else "See it on" wherever the listing is (Instagram, a
// city guide's post, the organiser's own site).
const TICKET_SITES = /^(BookMyShow|District|Skillboxes|Eventbrite|Ticketmaster|DICE|Resident Advisor|Eventim|GoOut|Platinumlist|SISTIC|Ticketek|Klook|Shotgun|Fever|Luma|Urbanaut|Live Your City|AllEvents|Meetup)$/;

export function eventLinkLabel(site: string) {
  return `${TICKET_SITES.test(site) ? "Tickets on" : "See it on"} ${site}`;
}
