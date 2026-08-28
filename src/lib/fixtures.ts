import type { Provider } from "./providers";

/** Bundled sample OTA pages so the playground works with zero network access. */

type Fixture = { label: string; url: string; provider: Provider; html: string };

const airbnb = (): string => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: "Sunlit Coorg Coffee Estate Cottage",
    description:
      "Wake up to birdsong on our family coffee estate near Madikeri. This standalone 2-bedroom cottage has a wraparound verandah, a fully equipped kitchen, and a caretaker on site. Perfect for families and couples wanting a quiet hill retreat. Home-cooked Kodava breakfast included.",
    image: [
      "https://a0.muscache.com/im/pictures/estate/cottage-front.jpg?im_w=1200",
      "https://a0.muscache.com/im/pictures/estate/verandah.jpg?im_w=1200",
      "https://a0.muscache.com/im/pictures/estate/bedroom1.jpg?im_w=1200",
      "https://a0.muscache.com/im/pictures/estate/kitchen.jpg?im_w=1200",
    ],
    address: {
      "@type": "PostalAddress",
      streetAddress: "Galibeedu Road",
      addressLocality: "Madikeri",
      addressRegion: "Karnataka",
      postalCode: "571201",
      addressCountry: "IN",
    },
    geo: { "@type": "GeoCoordinates", latitude: 12.4212, longitude: 75.7285 },
    aggregateRating: { "@type": "AggregateRating", ratingValue: 4.92, reviewCount: 128 },
    priceRange: "₹6500",
  };
  return `<!doctype html><html><head>
    <title>Sunlit Coorg Coffee Estate Cottage - Madikeri - Airbnb</title>
    <meta property="og:title" content="Sunlit Coorg Coffee Estate Cottage">
    <meta property="og:description" content="Entire cottage hosted by Nanda. 4 guests · 2 bedrooms · 3 beds · 2 baths">
    <meta property="og:image" content="https://a0.muscache.com/im/pictures/estate/cottage-front.jpg?im_w=1200">
    <meta name="description" content="Entire home in Madikeri. Coffee estate cottage with verandah, ₹6,500 per night.">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head><body>
    <h1>Sunlit Coorg Coffee Estate Cottage</h1>
    <p>Entire cottage · 4 guests · 2 bedrooms · 3 beds · 2 bathrooms</p>
    <p>₹6,500 per night · Free cancellation for 48 hours</p>
    <p>Minimum stay 2 nights. Check-in after 1:00 PM, checkout before 11:00 AM. No smoking. Pets allowed on request.</p>
    <ul>
      <li>Wifi</li><li>Free parking on premises</li><li>Kitchen</li><li>Breakfast</li>
      <li>Air conditioning</li><li>Power backup / inverter</li><li>Geyser / hot water</li>
      <li>Mountain view</li><li>Garden</li><li>Washer</li><li>TV</li>
    </ul>
    <img src="https://a0.muscache.com/im/pictures/estate/cottage-front.jpg?im_w=1200">
    <img src="https://a0.muscache.com/im/pictures/estate/verandah.jpg?im_w=1200">
    <img src="https://a0.muscache.com/im/pictures/estate/bedroom1.jpg?im_w=720">
    <img data-src="https://a0.muscache.com/im/pictures/estate/kitchen.jpg?im_w=1200">
  </body></html>`;
};

const booking = (): string => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: "Backwater Breeze Homestay",
    description:
      "A restored Kerala tharavadu on the banks of the Alappuzha backwaters. Three air-conditioned rooms open onto a shared sit-out overlooking the water. Canoe rides and toddy-shop tours arranged. Traditional sadya lunch on request.",
    image: [
      "https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-exterior.jpg?k=abc",
      "https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-room.jpg?k=def",
      "https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-water.jpg?k=ghi",
    ],
    address: {
      "@type": "PostalAddress",
      streetAddress: "Punnamada Road",
      addressLocality: "Alappuzha",
      addressRegion: "Kerala",
      postalCode: "688006",
      addressCountry: "IN",
    },
    geo: { "@type": "GeoCoordinates", latitude: 9.5012, longitude: 76.3419 },
    aggregateRating: { "@type": "AggregateRating", ratingValue: 8.9, reviewCount: 342 },
  };
  return `<!doctype html><html><head>
    <title>Backwater Breeze Homestay, Alappuzha – Updated Prices</title>
    <meta property="og:title" content="Backwater Breeze Homestay">
    <meta property="og:description" content="Homestay in Alappuzha, on the backwaters. 2 guests per room.">
    <meta property="og:image" content="https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-exterior.jpg?k=abc">
    <meta name="description" content="Private room · 2 guests · 1 bedroom · 1 bath · from ₹3,200 per night">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head><body>
    <h1>Backwater Breeze Homestay</h1>
    <p>Private room in homestay · 2 guests · 1 bedroom · 1 bed · 1 bathroom</p>
    <p>Price: ₹ 3,200 per night. Free cancellation up to 3 days before arrival.</p>
    <p>Check-in from 12:00, check-out until 10:00. Minimum stay 1 night. No smoking indoors.</p>
    <div>Facilities: Free WiFi, Airport shuttle, Air conditioning, Free parking, Breakfast, Garden, Terrace, Family rooms, Non-smoking rooms</div>
    <img src="https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-exterior.jpg?k=abc">
    <img src="https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-room.jpg?k=def">
    <img src="https://cf.bstatic.com/xdata/images/hotel/max1024/breeze-water.jpg?k=ghi">
  </body></html>`;
};

const agoda = (): string =>
  `<!doctype html><html><head>
    <title>Himalayan Orchard Stay, Manali - Agoda</title>
    <meta property="og:title" content="Himalayan Orchard Stay">
    <meta property="og:description" content="Villa in Manali surrounded by an apple orchard. 6 guests, 3 bedrooms.">
    <meta property="og:image" content="https://pix8.agoda.net/hotelImages/orchard/exterior.jpg?ca=1">
    <meta name="description" content="Entire villa · 6 guests · 3 bedrooms · 4 beds · 3 baths · ₹9,800/night">
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Himalayan Orchard Stay",
      description:
        "A wooden villa in Nashala village, 20 minutes from Manali mall road, set inside a working apple orchard with uninterrupted views of the Dhauladhar range. Bukhari (wood stove) in the living room, modern kitchen, and a bonfire pit.",
      image: [
        "https://pix8.agoda.net/hotelImages/orchard/exterior.jpg?ca=1",
        "https://pix8.agoda.net/hotelImages/orchard/living.jpg?ca=1",
        "https://pix8.agoda.net/hotelImages/orchard/view.jpg?ca=1",
      ],
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.7, reviewCount: 89 },
    })}</script>
  </head><body>
    <h1>Himalayan Orchard Stay</h1>
    <p>Entire villa · 6 guests · 3 bedrooms · 4 beds · 3 bathrooms</p>
    <p>₹9,800 per night. Minimum stay 2 nights. Check-in 2:00 PM / Check-out 11:00 AM.</p>
    <p>Amenities: Free WiFi, Heating, Kitchen, Free parking, Mountain view, Balcony, Garden, Washing machine, TV, Pets allowed</p>
    <img src="https://pix8.agoda.net/hotelImages/orchard/exterior.jpg?ca=1">
    <img src="https://pix8.agoda.net/hotelImages/orchard/living.jpg?ca=1">
    <img src="https://pix8.agoda.net/hotelImages/orchard/view.jpg?ca=1">
  </body></html>`;

const makemytrip = (): string =>
  `<!doctype html><html><head>
    <title>Sea Shell Beach House, Gokarna | MakeMyTrip</title>
    <meta property="og:title" content="Sea Shell Beach House">
    <meta property="og:image" content="https://r1imghtlak.mmtcdn.com/seashell/front.jpg">
    <meta name="description" content="Entire house in Gokarna, 3 min walk to Kudle beach. 5 guests, 2 bedrooms. Tariff Rs. 5500 per night.">
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "House",
      name: "Sea Shell Beach House",
      description:
        "Two-bedroom house a three-minute walk from Kudle Beach in Gokarna. Sea-facing balcony, open kitchen, hammock garden. Scooter rentals and surf lessons arranged by the caretaker.",
      image: [
        "https://r1imghtlak.mmtcdn.com/seashell/front.jpg",
        "https://r1imghtlak.mmtcdn.com/seashell/balcony.jpg",
      ],
      address: {
        "@type": "PostalAddress",
        addressLocality: "Gokarna",
        addressRegion: "Karnataka",
        postalCode: "581326",
        addressCountry: "IN",
      },
      geo: { "@type": "GeoCoordinates", latitude: 14.5479, longitude: 74.3188 },
    })}</script>
  </head><body>
    <h1>Sea Shell Beach House</h1>
    <p>Entire house · 5 guests · 2 bedrooms · 3 beds · 2 bathrooms</p>
    <p>Tariff Rs. 5,500 per night · Non-refundable rate</p>
    <p>Check-in 12:00 PM, Check-out 10:00 AM. Minimum stay 2 nights.</p>
    <p>Facilities: WiFi, Air Conditioning, Kitchen, Free Parking, Sea view, Balcony, Garden, Power backup, Geyser</p>
    <img src="https://r1imghtlak.mmtcdn.com/seashell/front.jpg">
    <img src="https://r1imghtlak.mmtcdn.com/seashell/balcony.jpg">
  </body></html>`;

const goibibo = (): string =>
  `<!doctype html><html><head>
    <title>Riverside Camp & Cottages, Rishikesh - Goibibo</title>
    <meta property="og:title" content="Riverside Camp & Cottages">
    <meta property="og:image" content="https://gos3.ibcdn.com/riverside/tent.jpg">
    <meta name="description" content="Private cottage near Shivpuri, Rishikesh. 2 guests. INR 2800 per night incl. breakfast.">
  </head><body>
    <h1>Riverside Camp &amp; Cottages</h1>
    <p>Private room · 2 guests · 1 bedroom · 1 bed · 1 bathroom</p>
    <p>INR 2,800 per night including breakfast. Free cancellation.</p>
    <p>A Swiss-tent cottage 15 km upstream of Rishikesh at Shivpuri, walking distance to the Ganga. Rafting put-in point is 500 m away. Bonfire and vegetarian buffet dinner included.</p>
    <p>Check in 11:00 AM, check out 9:00 AM. Minimum stay 1 night. No alcohol on premises.</p>
    <p>Amenities: WiFi in common area, Hot water, Parking, Breakfast, Bonfire, Mountain view, River view</p>
    <img src="https://gos3.ibcdn.com/riverside/tent.jpg">
    <img src="https://gos3.ibcdn.com/riverside/river.jpg">
  </body></html>`;

export const FIXTURES: Record<string, Fixture> = {
  airbnb: {
    label: "Airbnb — Coorg estate cottage (rich JSON-LD)",
    url: "https://www.airbnb.co.in/rooms/12345678",
    provider: "airbnb",
    html: airbnb(),
  },
  booking: {
    label: "Booking.com — Alappuzha backwater homestay",
    url: "https://www.booking.com/hotel/in/backwater-breeze.html",
    provider: "booking",
    html: booking(),
  },
  agoda: {
    label: "Agoda — Manali orchard villa",
    url: "https://www.agoda.com/himalayan-orchard-stay/hotel/manali-in.html",
    provider: "agoda",
    html: agoda(),
  },
  makemytrip: {
    label: "MakeMyTrip — Gokarna beach house",
    url: "https://www.makemytrip.com/hotels/sea_shell_beach_house-details-gokarna.html",
    provider: "makemytrip",
    html: makemytrip(),
  },
  goibibo: {
    label: "Goibibo — Rishikesh riverside cottage (sparse, no JSON-LD)",
    url: "https://www.goibibo.com/hotels/riverside-camp-cottages-hotel-in-rishikesh/",
    provider: "goibibo",
    html: goibibo(),
  },
};

export type FixtureKey = keyof typeof FIXTURES;
