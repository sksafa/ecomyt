// Bangladesh administrative geography used for addresses and delivery zones.
export const DIVISIONS: Record<string, { bn: string; districts: [string, string][] }> = {
  Dhaka: {
    bn: "ঢাকা",
    districts: [
      ["Dhaka", "ঢাকা"], ["Faridpur", "ফরিদপুর"], ["Gazipur", "গাজীপুর"], ["Gopalganj", "গোপালগঞ্জ"],
      ["Kishoreganj", "কিশোরগঞ্জ"], ["Madaripur", "মাদারীপুর"], ["Manikganj", "মানিকগঞ্জ"], ["Munshiganj", "মুন্সিগঞ্জ"],
      ["Narayanganj", "নারায়ণগঞ্জ"], ["Narsingdi", "নরসিংদী"], ["Rajbari", "রাজবাড়ী"], ["Shariatpur", "শরীয়তপুর"],
      ["Tangail", "টাঙ্গাইল"],
    ],
  },
  Chattogram: {
    bn: "চট্টগ্রাম",
    districts: [
      ["Bandarban", "বান্দরবান"], ["Brahmanbaria", "ব্রাহ্মণবাড়িয়া"], ["Chandpur", "চাঁদপুর"], ["Chattogram", "চট্টগ্রাম"],
      ["Cox's Bazar", "কক্সবাজার"], ["Cumilla", "কুমিল্লা"], ["Feni", "ফেনী"], ["Khagrachhari", "খাগড়াছড়ি"],
      ["Lakshmipur", "লক্ষ্মীপুর"], ["Noakhali", "নোয়াখালী"], ["Rangamati", "রাঙ্গামাটি"],
    ],
  },
  Rajshahi: {
    bn: "রাজশাহী",
    districts: [
      ["Bogura", "বগুড়া"], ["Chapai Nawabganj", "চাঁপাইনবাবগঞ্জ"], ["Joypurhat", "জয়পুরহাট"], ["Naogaon", "নওগাঁ"],
      ["Natore", "নাটোর"], ["Pabna", "পাবনা"], ["Rajshahi", "রাজশাহী"], ["Sirajganj", "সিরাজগঞ্জ"],
    ],
  },
  Khulna: {
    bn: "খুলনা",
    districts: [
      ["Bagerhat", "বাগেরহাট"], ["Chuadanga", "চুয়াডাঙ্গা"], ["Jashore", "যশোর"], ["Jhenaidah", "ঝিনাইদহ"],
      ["Khulna", "খুলনা"], ["Kushtia", "কুষ্টিয়া"], ["Magura", "মাগুরা"], ["Meherpur", "মেহেরপুর"],
      ["Narail", "নড়াইল"], ["Satkhira", "সাতক্ষীরা"],
    ],
  },
  Barishal: {
    bn: "বরিশাল",
    districts: [
      ["Barguna", "বরগুনা"], ["Barishal", "বরিশাল"], ["Bhola", "ভোলা"], ["Jhalokati", "ঝালকাঠি"],
      ["Patuakhali", "পটুয়াখালী"], ["Pirojpur", "পিরোজপুর"],
    ],
  },
  Sylhet: {
    bn: "সিলেট",
    districts: [["Habiganj", "হবিগঞ্জ"], ["Moulvibazar", "মৌলভীবাজার"], ["Sunamganj", "সুনামগঞ্জ"], ["Sylhet", "সিলেট"]],
  },
  Rangpur: {
    bn: "রংপুর",
    districts: [
      ["Dinajpur", "দিনাজপুর"], ["Gaibandha", "গাইবান্ধা"], ["Kurigram", "কুড়িগ্রাম"], ["Lalmonirhat", "লালমনিরহাট"],
      ["Nilphamari", "নীলফামারী"], ["Panchagarh", "পঞ্চগড়"], ["Rangpur", "রংপুর"], ["Thakurgaon", "ঠাকুরগাঁও"],
    ],
  },
  Mymensingh: {
    bn: "ময়মনসিংহ",
    districts: [["Jamalpur", "জামালপুর"], ["Mymensingh", "ময়মনসিংহ"], ["Netrokona", "নেত্রকোণা"], ["Sherpur", "শেরপুর"]],
  },
};

export const DELIVERY_ZONES = [
  { code: "INSIDE_DHAKA", name: "Inside Dhaka", baseCharge: "70.00", perKgCharge: "15.00", sortOrder: 1 },
  { code: "SUB_DHAKA", name: "Dhaka Suburbs", baseCharge: "100.00", perKgCharge: "20.00", sortOrder: 2 },
  { code: "OUTSIDE_DHAKA", name: "Outside Dhaka", baseCharge: "130.00", perKgCharge: "20.00", sortOrder: 3 },
];

/** District → zone. Unlisted districts are OUTSIDE_DHAKA. */
export const DISTRICT_ZONE: Record<string, string> = { Dhaka: "INSIDE_DHAKA", Gazipur: "SUB_DHAKA", Narayanganj: "SUB_DHAKA" };

/** Dhaka district areas; the suburban ones override the district zone. */
export const DHAKA_AREAS: [string, string?][] = [
  ["Adabor"], ["Badda"], ["Banani"], ["Banasree"], ["Bangshal"], ["Baridhara"], ["Bashundhara R/A"], ["Cantonment"],
  ["Chawkbazar"], ["Dakshinkhan"], ["Demra"], ["Dhanmondi"], ["Farmgate"], ["Gulshan"], ["Hazaribagh"], ["Jatrabari"],
  ["Kafrul"], ["Kalabagan"], ["Kamrangirchar"], ["Khilgaon"], ["Khilkhet"], ["Kotwali"], ["Lalbagh"], ["Malibagh"],
  ["Mirpur"], ["Moghbazar"], ["Mohakhali"], ["Mohammadpur"], ["Motijheel"], ["Mugda"], ["New Market"], ["Pallabi"],
  ["Paltan"], ["Ramna"], ["Rampura"], ["Sabujbagh"], ["Shah Ali"], ["Shahbagh"], ["Shyampur"], ["Sutrapur"],
  ["Tejgaon"], ["Turag"], ["Uttara"], ["Uttarkhan"], ["Vatara"], ["Wari"],
  ["Savar", "SUB_DHAKA"], ["Keraniganj", "SUB_DHAKA"], ["Dhamrai", "SUB_DHAKA"], ["Dohar", "SUB_DHAKA"], ["Nawabganj", "SUB_DHAKA"],
];
