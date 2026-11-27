/* engine-local.js - Zero-network deterministic TopPay SOP rules & template engine (v3.6).
   Mirrors api/rules_engine.py + api/case.py + api/templates_store.py 100% locally in <0.5ms. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TPEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BUILTIN_COMPACT = {"adr.01":["অনুগ্রহ করে বর্তমান ঠিকানা submit করুন (রোড নম্বর, হোল্ডিং নম্বর, ওয়ার্ড নম্বর এবং নিকটস্থ কোনো পরিচিত স্থান/ল্যান্ডমার্ক)।","address","return"],"adr.02":["অনুগ্রহ করে কাস্টমার এর বর্তমান ঠিকানা দিন। গ্রাম,থানা, জেলা, পোস্ট অফিস এবং বাসার পাশে স্কুল/কলেজ/বাজার এগুলো থাকলে উল্লেখ করে দিবেন।","address","return"],"adr.03":["অনুগ্রহ করে বর্তমান এবং স্থায়ী ঠিকানা submit করুন (রোড নম্বর, হোল্ডিং নম্বর, ওয়ার্ড নম্বর অথবা নিকটস্থ কোনো পরিচিত স্থান/ল্যান্ডমার্ক)।","address","return"],"adr.04":["ঠিকানার সাথে নিকটস্থ পরিচিত স্থান (যেমন: স্কুল, কলেজ, বাজার) উল্লেখ করুন।","address","return"],"adr.05":["কাস্টমার এর NID এর ঠিকানা পার্মানেন্ট এড্রেস এই অপসন এ দিন এবং বর্তমান ঠিকানা Residential Address এই অপসন এ দিন।","address","return"],"adr.06":["কাস্টমার এর সাথে bp এর ছবি তুলে Onsite photos এই অপসন এ সাবমিট করুন।","address","return"],"adr.07":["Photo of Signature এ কাস্টমারের সাইন লাগবে। শুধু আঁকিঝুঁকি করে দিলে হবে না।","address","return"],"adr.08":["মোবাইল বক্সের IMEI নম্বর স্পষ্টভাবে দেখা যায় এমন একটি ছবি তুলে Onsite photos এই অপসন এ সাবমিট করুন।","address","return"],"adr.09":["কাস্টমারকে BP-এর সাথে নিজের মুখ দেখা যায় এমন একটি ছবি জমা দিতে হবে। Onsite photos এই অপসন এ সাবমিট করুন।","address","return"],"adr.10":["মোবাইল বক্সের IMEI নম্বর সিস্টেমের IMEI-এর সাথে মিলে না। সিস্টেম এর IMEI নম্বর এবং মোবাইল box এর IMEI নম্বর এক হতে হবে।","address","return"],"adr.11":["কাস্টমার এর PalmPay লোন অ্যাপ থেকে ২টি স্ক্রিনশট জমা দিন।\n1. Login ID\n2. Payment History","address","return"],"adr.12":["কাস্টমার এর MoMo Emi লোন অ্যাপ থেকে ২টি স্ক্রিনশট জমা দিন।\n1. Login ID\n2. Payment History","address","return"],"adr.13":["কাস্টমার এবং জামিনদার এর সম্পর্ক ঠিক করে লিখুন","address","return"],"adr.14":["অনুগ্রহ করে কলিগ এর নাম্বার টা পরিবর্তন করে দিন","address","return"],"adr.15":["অনুগ্রহ করে কলিগ এর নাম এবং নাম্বার এর তথ্য সাবমিট করুন","address","return"],"adr.16":["কাস্টমার এর PalmPay লোন অ্যাপ থেকে ২টি স্ক্রিনশট জমা দিন(যে নম্বর দিয়ে Toppay তে আবেদন করেছে সে নম্বর দিয়ে palmpay apps এ login করে তথ্য দিন। )\n1. লগইন আইডি সেকশন\n2. পেমেন্ট হিস্ট্রি সেকশন","address","return"],"adr.17":["গ্রাহককে অবশ্যই সেই ইনস্টলমেন্ট PALMPAY LIMITED অ্যাপের (Login interface) এবং (Paid off & Unpaid) এই ২টি স্ক্রিনশট জমা দিতে হবে, যেখান থেকে তিনি পূর্বে ইনস্টলমেন্টে ফোন নিয়েছিলেন। স্ক্রিনশটগুলোতে তার নাম, নম্বর এবং লেনদেনের বিবরণ অবশ্যই থাকতে হবে।","address","return"],"adr.18":["কাস্টমার এর SahajMobile লোন অ্যাপ থেকে ২টি স্ক্রিনশট জমা দিন(যে নম্বর দিয়ে toppay তে আবেদন করেছে সে নম্বর দিয়ে Sahaj apps এ login করে তথ্য দিন। )\n1. লগইন আইডি সেকশন\n2. পেমেন্ট হিস্ট্রি সেকশন","address","return"],"adr.19":["বর্তমান ও স্থায়ী ঠিকানা ডিটেইলস এ দিতে হবে হোল্ডিং নাম্বার, ল্যান্ডমার্কসহ ।","address","return"],"adr.20":["শুধু কাস্টমার এর সাথে bp এর ছবি তুলে On Site এ জমা দিন।","address","return"],"adr.21":["কাস্টমারের ambala commerce এ লোন আছে , কাস্টমারের নাম , নাম্বার দেখিয়ে momo emiএ লগ ইন করে লগ ইন অংশের স্ক্রিনশট ও emi detailsএর লোন রেকর্ডের paidoff অংশের স্ক্রিনশট প্রদান করুন।","address","return"],"adr.22":["কাস্টমার এর Ambala লোন অ্যাপ থেকে ২টি স্ক্রিনশট জমা দিন(যে নম্বর দিয়ে Ambala থেকে লোন নেওয়া হয়েছিল সে নম্বর দিয়ে Ambala apps এ login করে তথ্য দিন। )\n1. লগইন আইডি সেকশন\n2. পেমেন্ট হিস্ট্রি সেকশন","address","return"],"adr.23":["কাস্টমার এর PalmPay লোন অ্যাপ থেকে ৩ টি স্ক্রিনশট জমা দিন(যে নম্বর দিয়ে Palmpay থেকে লোন নেওয়া হয়েছিল সে নম্বর দিয়ে palmpay apps এ login করে তথ্য দিন। )","address","return"],"biz.01":["Valid ট্রেড লাইসেন্সের কপি অথবা দোকানের সাইনবোর্ডের ছবি submit করুন। ক্যাশ কাউন্টারে বসা অবস্থায় কাস্টমারের ছবি দিন।","business","return"],"biz.02":["অনুগ্রহ করে সাইন বোর্ড সহ দোকানের ছবি Submit দিন। সাইন বোর্ড না থাকলে দোকানের ছবি দিন সাথে cash memo বই সহ cash memo এর ছবি দিন।","business","return"],"biz.03":["ট্রেড লাইসেন্স এর মেয়াদ উত্তীর্ণ হয়ে গেছে ,অনুগ্রহ করে রিনিউ ট্রেড লাইসেন্স প্রদান করুন অথবা সাইন বোর্ড সহ দোকানের ছবি submit করুন। ক্যাশ কাউন্টারে বসা অবস্থায় কাস্টমারের ছবি দিন।","business","return"],"biz.04":["কাস্টমার একজন ব্যবসায়ী, Businessman হিসেবে আবেদন করুন।","business","return"],"biz.05":["মিনি স্টেটমেন্ট গ্রহণযোগ্য নয় , ব্যাংক থেকে details স্টেটমেন্ট নিয়ে আসুন অথবা ব্যাংক এর apps থেকে details স্টেটমেন্ট ডাউনলোড করে pdf ফাইল submit করুন।","business","return"],"biz.06":["কাস্টমার Rider হিসেবে আবেদন করেছেন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে Rider হিসেবে আবেদন করলে ৪০% down payment দিতে হবে। তা না হলে উনি ৫০ হাজার এর নিচের ফোন এর জন্য আবেদন করতে পারবেন।","business","return"],"biz.07":["কাস্টমার একজন Land owner হিসেবে আবেদন করেছেন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে land owner হিসেবে আবেদন করলে মাসিক বাড়ি ভাড়া পাওয়ার রশিদ দিতে হবে। (কাস্টমার একজন বাড়ির মালিক এবং উনি বাড়ি ভাড়া পান সেই রশিদ)। তা না হলে কাস্টমার এই ফোন এর জন্য ৪০% downpayment দিয়ে নিতে পারবেন। আর সেটা না পারলে অনুগ্রহ করে ৫০ হাজার এর কমদামি ফোন এর জন্য আবেদন করুন।","business","return"],"con.01":["কাস্টমার কে কল করে পাওয়া যায় নি। ফোন বন্ধ।","contact","return"],"con.02":["কাস্টমার কোন কথা শুনতে পান না। অনুগ্রহ করে নেটওয়ার্ক পাওয়া যায় এমন জায়গায় গিয়ে কথা বলুন অথবা কাস্টমার এর সিম টি আপনার (বিপি) ফোন এ তুলুন।","contact","return"],"con.03":["গ্রাহকের সাথে ৩ বার যোগাযোগের চেষ্টা করেও যোগাযোগ সম্ভব হয়নি। অনুগ্রহ করে উনাকে বলুন ফোন রিসিভ করতে।","contact","return"],"con.04":["কাস্টমার কে কল করে পাওয়া যায় নি। ফোন রিসিভ করছেন না। অনুগ্রহ করে উনাকে বলুন ফোন রিসিভ করতে।","contact","return"],"con.05":["জামিনদার কে কল করে পাওয়া যায় নি। ফোন রিসিভ করছেন না। অনুগ্রহ করে উনাকে বলুন ফোন রিসিভ করতে।","contact","return"],"con.06":["জামিনদার কে কল করে পাওয়া যায় নি। ফোন বন্ধ। নম্বর চেক করে রিসাবমিট করুন।","contact","return"],"con.07":["Colleague কে কল করে পাওয়া যায় নি। ফোন বন্ধ।","contact","return"],"con.08":["কাস্টমার এবং জামিনদার কে কল করে পাওয়া যায় নি।","contact","return"],"con.09":["জামিনদার কে কল করে পাওয়া যায় নি।","contact","return"],"con.10":["জামিনদার এর নম্বর ভুল সঠিক ফোন নম্বর দিন।","contact","return"],"con.11":["বিপির সাথে যোগাযোগ করা সম্ভব হয়নি","contact","return"],"con.12":["BP কে কল করে পাওয়া যায় নি। ফোন বন্ধ। নম্বর চেক করে রিসাবমিট করুন।","contact","return"],"con.13":["অনুগ্রহ করে জামিনদার এর একটি ভিডিও whatsapp গ্রুপ এ share করুন যেখানে জামিনদার উনার নাম বলবেন এবং কাস্টমার এর সাথে উনার কি সম্পর্ক সেটা বলবেন। ধন্যবাদ।","contact","return"],"con.14":["অনুগ্রহ করে রিটার্ন এর কারণগুলো ভালো করে দেখুন , সংশোধন না করে বার বার রিসাবমিট করলে ডাটা টি রিজেক্ট হয়ে যাবে।","contact","return"],"con.15":["অনুগ্রহ করে কাস্টমারের ব্যক্তিগত মোবাইল নম্বর দিন। অফিস/অফিসিয়াল ফোন নম্বর গ্রহণযোগ্য নয়।","contact","return"],"gua.01":["অনুগ্রহ করে কাস্টমার ও গ্যারান্টরের সম্পর্ক সংশোধন করুন।","guarantor","return"],"gua.02":["জামিনদারের বয়স ৬২ বছরের বেশি। অনুগ্রহ করে জামিনদার পরিবর্তন করুন (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.03":["জামিনদারের বয়স ২১ বছরের কম। অনুগ্রহ করে জামিনদার পরিবর্তন করুন (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.04":["জামিনদারের বয়স ২১ বছরের কম। অনুগ্রহ করে জামিনদার পরিবর্তন করুন ( বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.05":["জামিনদার রক্তের সম্পর্কযুক্ত বা স্বামী/স্ত্রী নন। অনুগ্রহ করে জামিনদার পরিবর্তন করুন (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.06":["জামিনদার এর NID কার্ড টি EC পোর্টাল ( Internet portal) থেকে পুনরায় ডাউনলোড করে সেটি কালার প্রিন্ট করে লেমিনেটেড করে তারপর সাবমিট করুন . বর্তমান NID কার্ডে তার কোন ফিঙ্গারপ্রিন্ট, সিগনেচার (Sign) দেখা যাচ্ছে না .সঠিকভাবে সাবমিট করবেন","guarantor","return"],"gua.07":["জামিনদারের মায়ের নামের সাথে কাস্টমার এর মায়ের নাম এর মিল নেই। । অনুগ্রহ করে জামিনদার পরিবর্তন করুন (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.08":["জামিনদার এই লোন এর দায়িত্ব নিতে রাজি নয় । অনুগ্রহ করে জামিনদার পরিবর্তন করুন (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১–৬২ বছর)।","guarantor","return"],"gua.09":["কাস্টমার কিছুই করেন না (বেকার), তাই জামিনদারের পেশা থাকতে হবে। জামিনদারের পেশা নেই। অনুগ্রহ করে জামিনদার পরিবর্তন করুন।","guarantor","return"],"gua.10":["গ্যারান্টার পরিবর্তন করে দিতে হবে। স্টেটমেন্ট এ যার নাম আছে তাকে গ্যারান্টর দিতে হবে। গ্যারান্টার অবশ্যই ফার্স্ট ব্লাড হতে হবে (শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী গ্যারান্টার হতে পারবে) ।","guarantor","return"],"job.01":["কাস্টমার এর valid job id সাবমিট করুন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে job holder হিসেবে আবেদন করলে Job id দিতে হবে।","job","return"],"job.02":["গত ৩ মাসের স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি (ক্যাশ ইন অথবা ক্যাশ আউট মিলিয়ে ১৫,০০০টাকা , অনুগ্রহ করে গ্রাহকের অন্য স্টেটমেন্ট বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই স্টেটমেন্ট সাবমিট করুন।","job","return"],"job.03":["ভ্যালিড জব ডকুমেন্ট দিতে হবে। অথবা {m3_bn_sp} মাসে ৩০ হাজার টাকার উপরে লেনদেন থাকতে হবে। যদি এই গুলা না থাকে তাহলে ৫০ হাজার টাকার দামের মোবাইল নিতে হবে","job","return"],"job.04":["Job ID এর দুই পাশের ছবি দেওয়া হয় নি, উভয় পাশের ছবি দিন।","job","return"],"job.05":["কাস্টমারের অরিজিনাল জব আইডি কার্ড দিতে হবে, অথবা জব রিলেটেড ডকুমেন্টস, অথবা 40% ডাউনপেমেন্ট করতে হবে, অথবা ৩০ হাজার টাকা লেনদেন আছে এমন স্টেটমেন্ট দিতে হবে, অথবা গ্রাহক প্রয়োজনীয় মানদণ্ড পূরণকারী একটি স্যালারি স্লিপ প্রদান করবে এবং মাসিক বেতন ২৫,০০০ টাকার বেশি হবে, অথবা ৫০ হাজার টাকার নিচের ফোনের জন্য এপ্লাই করুন।\nস্যালারি স্লিপটিকে অবশ্যই নিম্নলিখিত শর্তাবলী পূরণ করতে হবে:\n● গ্রাহকের নিয়োগকর্তা কর্তৃক আনুষ্ঠানিকভাবে ইস্যুকৃত হতে হবে;\n● কোম্পানির অফিসিয়াল সিল বা ব্যবসায়িক সিল থাকতে হবে (হাতে লেখা স্বাক্ষর বা হাতে লেখা সিল গ্রহণযোগ্য নয়);\n●কোম্পানির নাম, কোম্পানির ঠিকানা, যোগাযোগের টেলিফোন নম্বর, কর্মচারীর নাম, পদবি, বেতনের পরিমাণ এবং অন্যান্য প্রাসঙ্গিক চাকরির তথ্য অন্তর্ভুক্ত থাকতে হবে।","job","return"],"nid.01":["অনুগ্রহ করে কাস্টমার এর NID এর স্পষ্ট ছবি দিন। কাস্টমার এর চেহারা বোঝা যায় না।","nid","return"],"nid.02":["কাস্টমারের Original NID-এর উভয় পাশের ছবি জমা দিন; ফটোকপি/স্ক্যান কপি NID গ্রহণযোগ্য নয়।","nid","return"],"nid.03":["জামিনদার এর Original NID , ফটোকপি/স্ক্যান কপি NID গ্রহণযোগ্য , ফোন থেকে ফোনে তোলা ছবি গ্রহণযোগ্য না","nid","return"],"nid.04":["কাস্টমার এর NID নির্বাচন অফিস থেকে বাতিল করা হয়েছে। পলিসি অনুযায়ী বাতিল NID গ্রহণযোগ্য নয়। অনুগ্রহ করে কাস্টমার এর অরিজিনাল NID এর ছবি দিন।","nid","return"],"nid.05":["জামিনদার এর NID নির্বাচন অফিস থেকে বাতিল করা হয়েছে। পলিসি অনুযায়ী বাতিল NID গ্রহণযোগ্য নয়। অনুগ্রহ করে জামিনদার এর অরিজিনাল NID এর ছবি দিন। জামিনদার এর NID কার্ড এর ফটোকপি, স্ক্যান কপি গ্রহণযোগ্য।","nid","return"],"nid.06":["অনুগ্রহ করে জামিনদারের জাতীয় পরিচয় পত্রটি পরিবর্তন করে স্মার্ট কার্ডের উভয় পাশের ছবি সাবমিট করুন কারণ যে জাতীয় পরিচয় পত্রটি সাবমিট করেছেন সেটি ফুটো করা বা ছিদ্র করা যা গ্রহণযোগ্য নয়","nid","return"],"nid.07":["গ্রাহকের NID কার্ড টি EC পোর্টাল (Internet portal) থেকে পুনরায় ডাউনলোড করে সেটি কালার প্রিন্ট করে লেমিনেটেড করে তারপর সাবমিট করুন . বর্তমান NID কার্ডে তার কোন ফিঙ্গারপ্রিন্ট, সিগনেচার (Sign) দেখা যাচ্ছে না .সঠিকভাবে সাবমিট করবেন","nid","return"],"nid.08":["জামিনদার এর NID কার্ড এর স্পষ্ট ছবি দিন যেন উভয় পাশের সকল তথ্য বোঝা যায়।","nid","return"],"nid.09":["NID অনুযায়ী কাস্টমারের নাম সংশোধন করুন।","nid","return"],"nid.10":["NID অনুযায়ী গ্যারান্টরের নাম সংশোধন করুন।","nid","return"],"nid.11":["কাস্টমারের NID-এর উভয় পাশের ছবি দেওয়া হয় নি ।","nid","return"],"nid.12":["গ্যারান্টরের NID-এর উভয় পাশের ছবি দেওয়া হয় নি ।","nid","return"],"nid.13":["কাস্টমারের original NID অথবা lamenting করা NID এর উভয় পাশের ছবি জমা দিন; ফটোকপি/স্ক্যান কপি / ছবির ছবি / Crop করা গ্রহণযোগ্য নয়।","nid","return"],"nid.14":["কাইন্ডলি কাস্টমারের অরিজিনাল এনআইডি কার্ডের ক্লিয়ার ছবি সাবমিট করুন। কোনো প্রকার স্ক্রিনশট /স্ক্যান কপি/ ফটোকপি / মোবাইল ফোনের ভেতর থেকে তোলা ছবি গ্রহণ করা হয় না।","nid","return"],"nid.15":["অনুগ্রহ করে গ্রাহকের অরিজিনাল পরিষ্কার এবং স্পষ্ট , জাতীয় পরিচয় পত্রের উভয় পাশে ছবি সাবমিট করুন যেন চেহারা (face) পরিষ্কার এবং স্পষ্ট দেখা যায় ।","nid","return"],"nid.16":["অনুগ্রহ করে জামিনদারের স্পষ্ট এবং পরিষ্কার উভয় পাশের জাতীয় পরিচয় পত্রের ছবি সাবমিট করুন। জামিনদারের NID তে যেন ছবি স্পষ্ট এবং পরিষ্কার দেখা এবং বোঝা যায়।","nid","return"],"nid.17":["গ্রাহকের অরিজিনাল NID Card এর ছবি দেয়া হয়নি, অনুগ্রহ করে অরিজিনাল NID Card এর ছবি সাবমিট করুন। আমরা scanned/photocopy ছবি গ্রহন করি না।","nid","return"],"nid.18":["1. গ্রাহকের মূল এনআইডি কার্ডের ছবি সাবমিট করুন (প্রিন্ট কপি গ্রহণযোগ্য নয়)।","nid","return"],"qi.01":["জামিনদারের বয়স {g_age_min}–{g_age_max} বছরের মধ্যে নয়। অনুগ্রহ করে জামিনদার পরিবর্তন করুন।","guarantor","return"],"qi.02":["কাস্টমারের অন্য লোন অ্যাপ/ইনস্টলমেন্টের প্রমাণ দিতে হবে। যে নম্বর দিয়ে TopPay-তে আবেদন করেছেন সেই নম্বর দিয়ে ওই অ্যাপে login করে (১) Login interface ও (২) Paid off & Unpaid হিস্ট্রির স্ক্রিনশট জমা দিন। স্ক্রিনশটে নাম, নম্বর ও লেনদেনের বিবরণ থাকতে হবে।","address","return"],"qi.03":["কাস্টমারের Live photo স্পষ্ট নয়। মুখ পরিষ্কার দেখা যায় এমন আলোতে BP-এর সাথে নতুন ছবি তুলে Onsite photos অপশনে সাবমিট করুন।","address","return"],"qi.04":["Customer is suspected of fraud. The front and back sides of the customer's NID card do not match.","reject","reject"],"qi.05":["Customer is suspected of fraud. The customer's NID card has no signature/fingerprint.","reject","reject"],"qi.06":["Guarantor is suspected of fraud. Someone else is pretending to be the guarantor.","reject","reject"],"qi.07":["Guarantor is suspected of fraud. A voice changer was used during the call.","reject","reject"],"qi.08":["The guarantor does not have the relationship with the customer that was declared.","reject","reject"],"qi.09":["Guarantor is suspected of fraud. The guarantor's video does not match the NID photo.","reject","reject"],"qi.10":["The guarantor is advising the customer against taking the loan.","reject","reject"],"qi.11":["Statement is suspected to be fake. The created date and the modified date of the PDF do not match.","reject","reject"],"qi.12":["Customer is suspected of fraud. The submitted statement belongs to someone else.","reject","reject"],"qi.13":["Customer is suspected of fraud. The account on the statement does not exist.","reject","reject"],"qi.14":["Statement is suspected to be fake. A fake seal/signature was found on the statement.","reject","reject"],"qi.15":["The customer has an existing overdue loan on another platform.","reject","reject"],"qi.16":["The customer has remaining installments on a previous phone loan.","reject","reject"],"qi.17":["Customer is suspected of fraud. The loan screenshot has been edited.","reject","reject"],"qi.18":["The customer is overage. The allowed age is {c_age_min}-{c_age_max}.","reject","reject"],"qi.19":["The customer is underage. The allowed age is {c_age_min}-{c_age_max}.","reject","reject"],"qi.20":["The customer works in a defense/media related profession - not served.","reject","reject"],"qi.21":["The customer lives abroad / is an expatriate - not served.","reject","reject"],"qi.22":["The customer is disabled - not served.","reject","reject"],"qi.23":["Customer is suspected of fraud. A fake marriage certificate / birth certificate was submitted.","reject","reject"],"qi.24":["The customer was rude/abusive during the verification call.","reject","reject"],"qi.25":["কাস্টমারের NID কার্ডের ছবির নম্বরের সাথে সিস্টেমে দেওয়া NID নম্বরের মিল নেই। সঠিক NID নম্বর দিন এবং NID কার্ডের স্পষ্ট ছবি জমা দিন।","nid","return"],"qi.26":["কাস্টমার, জামিনদার, ফ্যামিলি ও কলিগের ফোন নম্বর আলাদা আলাদা হতে হবে। একই নম্বর একাধিক জায়গায় দেওয়া যাবে না — সঠিক নম্বর দিয়ে রিসাবমিট করুন।","contact","return"],"qi.27":["ফ্যামিলি ফোন নম্বর দেওয়া হয়নি। অনুগ্রহ করে কাস্টমারের ফ্যামিলি ফোন নম্বর সাবমিট করুন।","contact","return"],"rej.01":["Rejected due to fake bKash statement. The bKash statement has been edited to include the customer's name. The original statement holder's name is {holder}","reject","reject"],"rej.02":["The customer has a disability and cann't see in one eye","reject","reject"],"rej.03":["Rejected due to fake Nagad statement.","reject","reject"],"rej.04":["The customer has a {months}-month overdue loan on PalmPay.","reject","reject"],"rej.05":["The customer's NID card has been identified as fake and AI-generated.","reject","reject"],"rej.06":["Customer is suspected of fraud. Someone else has spoken as a customer.","reject","reject"],"rej.07":["Customer is suspected of fraud. The customer’s NID photo appears to have been changed. The photo on the NID matches the customer’s on-site photo, including the same beard, hairstyle, and clothing.","reject","reject"],"rej.08":["Guarantor is suspected of fraud. No record of the guarantor's NID was found in the e-Passport verification portal.","reject","reject"],"rej.09":["Customer is suspected of fraud. No record of the customer's NID was found in the e-Passport verification portal.","reject","reject"],"rej.10":["suspected fraud. guarantor nid card fake (here guarantor sign / fingerprint doesn't exist ).","reject","reject"],"rej.11":["Customer is suspected of fraud. The customer's NID card was edited by changing the parents' names.","reject","reject"],"rej.12":["Guarantor is suspected of fraud. The guarantor's NID card was edited by changing the parents' names.","reject","reject"],"rej.13":["Guarantor is suspected of fraud. The guarantor's NID is fake. No record of the NID was found on the e-Passport verification portal.","reject","reject"],"rej.14":["Customer is suspected of fraud. The customer's PalmPay records have been edited.","reject","reject"],"rej.15":["Customer is suspected of fraud. The customer’s NID photo does not match the on-site photos.","reject","reject"],"rej.16":["As per the customer voice, the customer does not want to buy this phone anymore.","reject","reject"],"rej.17":["Suspected fraud. Guarantor NID card is fake (here guarantor sign / fingerprint doesn't exist). That`s why this application is rejected.","reject","reject"],"rej.18":["The required documents were requested multiple times and explained over the phone, but the BP kept resubmitting without providing them. Therefore, the application has been rejected.","reject","reject"],"rej.19":["The guarantor’s ears are not visible in the NID card photo. Normally, the ears should be visible in an NID card photo. This indicates that the NID card has been edited.","reject","reject"],"rej.20":["The customer identified the grantor as his wife; however, when contacted by phone, the grantor stated that the customer is her brother-in-law. Due to this discrepancy in the relationship information, the application was rejected on suspicion of fraud.","reject","reject"],"rej.21":["As per the customer voice , the guarantor is his friend, whereas the guarantor claims to be the customer's aunt's son (Khalato Bhai). As the customer and the guarantor failed to provide consistent information regarding their relationship, the application has been rejected.","reject","reject"],"rej.22":["As per the customer voice , the guarantor is his Aunt’s son , whereas the guarantor claims to be the customer's maternal cousin. As the customer and the guarantor failed to provide consistent information regarding their relationship, the application has been rejected.","reject","reject"],"rej.23":["Customer is suspected of fraud. The customer's NID card was edited.","reject","reject"],"rej.24":["Guarantor is suspected of fraud. The guarantor's NID card was edited.","reject","reject"],"rej.25":["Rejected due to fake bKash/Nagad statement. The statement has been edited.","reject","reject"],"rej.26":["The customer has an overdue loan on PalmPay.","reject","reject"],"rej.27":["Call information is incorrect or unverifiable - rejected for suspected fraud.","reject","reject"],"rej.28":["As the customer and the guarantor failed to provide consistent information regarding their relationship, the application has been rejected.","reject","reject"],"rej.29":["{who} is in a NOT SERVED category: {category}.","reject","reject"],"rej.30":["Applicant is outside the residential / permanent address area - not served.","reject","reject"],"rej.31":["The customer's age ({age}) is outside the allowed range ({range}).","reject","reject"],"stm.01":["গ্রাহকের গত ৩ মাসের ({m3}) PDF বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট প্রদান করা হয়নি,অনুগ্রহ করে সাবমিট করুন ।","statement","return"],"stm.02":["গ্রাহকের গত ৩ মাসের , {m1_bn} এর ১ তারিখ থেকে ({m3}) PDF স্টেটমেন্ট প্রদান করা হয়নি,অনুগ্রহ করে সাবমিট করুন ।","statement","return"],"stm.03":["অনুগ্রহ করে বিকাশের ৩ মাসের ({m3_bn}) স্টেটমেন্ট দিন।","statement","return"],"stm.04":["গত ৩ মাসের ({m3}) স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি ( আবেদন এর দিন থেকে গত ৭ দিন বাদ এ ( যে কোন এক মাসে ক্যাশ ইন অথবা ক্যাশ আউট মিলিয়ে ২০০০ টাকা)। অনুগ্রহ করে গ্রাহকের অন্য স্টেটমেন্ট বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই স্টেটমেন্ট সাবমিট করুন।","statement","return"],"stm.05":["যেহেতু বর্তমানে নগদ (Nagad) অ্যাপটি সচল থাকলেও স্টেটমেন্ট ডাউনলোড করা যাচ্ছে না, তাই অনুগ্রহ করে ১লা {m1_bn} থেকে শুরু করে গত ৩ মাসের লেনদেনের স্ক্রিনশট এবং একই সময়ের একটি ভিডিও প্রদান করুন। ভিডিওটি রেকর্ড করার সময় অনুগ্রহ করে ধীরে ধীরে স্ক্রল করবেন, যাতে প্রতিটি লেনদেন স্পষ্টভাবে দেখা যায়। পিডিএফ (PDF) ডাউনলোড সুবিধাটি পুনরায় চালু হলে, আমরা আমাদের আগের পদ্ধতিতে ফিরে যাব এবং তখন আপনার কাছে পিডিএফ ফাইলগুলো চাইব।","statement","return"],"stm.06":["গ্রাহকের অন্য একটি কোম্পানি থেকে পূর্বে একটি লোন ছিল, এবং সেই লোনটি এখনও আছে কি না তা নিশ্চিত করার জন্য আমাদের প্রমাণ প্রয়োজন। অন্য একটি ফোনের লোন পেমেন্ট অ্যাপ (Palmpay) থেকে স্ক্রিনশট প্রয়োজন: ১. লগইন আইডি অংশ ২. পেমেন্ট হিস্ট্রি অংশ ((loan records থেকে paid off এর স্ক্রিনশট দিতে হবে।","statement","return"],"stm.07":["বিকাশ স্টেটমেন্ট কাস্টমারের নামে নেই, উনি যদি উনার ফ্যামিলি মেম্বার(মা,বাবা,ভাই,বোন ) কারো নাম একাউন্ট খুলে থাকে এবং তার স্টেটমেন্ট দিতে চাচ্ছে গ্রাহক, তাহলে সেই ব্যক্তিকে গ্যারান্টার হিসেবে দিতে হবে।","statement","return"],"stm.08":["বিকাশ স্টেটমেন্ট কাস্টমারের নামে নেই, উনি যদি উনার ফ্যামিলি মেম্বার(মা,বাবা,ভাই,বোন ) কারো নাম একাউন্ট খুলে থাকে সেক্ষেত্রে তার স্টেটমেন্ট দিতে পারবে গ্রাহক এবং সেই ব্যক্তিকে গ্যারান্টার হিসেবে দিতে হবে।","statement","return"],"stm.09":["অনুগ্রহ করে গত ৩ মাসের বিকাশ এর Details স্টেটমেন্ট জমা দিন (সামারি/সংক্ষিপ্ত স্টেটমেন্ট গ্রহণযোগ্য নয়)।","statement","return"],"stm.10":["কাস্টমার/জামিনদার কারো নম্বর দিয়ে বিকাশ স্টেটমেন্টটি ওপেন হচ্ছে না;সঠিক PDF প্রদান করুন।","statement","return"],"stm.11":["যেহেতু কাস্টমার মায়ের বিকাশ স্টেটমেন্ট জমা দিয়েছেন,তাই মাকে জামিনদার হিসেবে দিতে হবে।\n(কাস্টমার এর মা এর বয়স যদি ৬২ বছরের বেশি হয় তাহলে জামিনদার দিতে হবে না। কাস্টমার এর মা এর NID কার্ড এর ছবি On site photos এই অপসন এ সাবমিট করুন।)","statement","return"],"stm.12":["যেহেতু কাস্টমার মায়ের বিকাশ স্টেটমেন্ট জমা দিয়েছেন,\n(কাস্টমার এর মা এর বয়স যদি ৬২ বছরের বেশি হ তাহলে জামিনদার দিতে হবে না। কাস্টমার এর মা এর NID কার্ড এর ছবি On site photos এই অপসন এ সাবমিট করুন।)","statement","return"],"stm.13":["যেহেতু কাস্টমার বাবার বিকাশ স্টেটমেন্ট জমা দিয়েছেন,তাই বাবাকে জামিনদার হিসেবে দিতে হবে।\n(কাস্টমার এর বাবার বয়স যদি ৬২ বছরের বেশি হয় তাহলে জামিনদার দিতে হবে না। কাস্টমার এর বাবার NID কার্ড এর ছবি On site photos এই অপসন এ সাবমিট করুন।)","statement","return"],"stm.14":["কাস্টমার এর bkash স্টেটমেন্ট তার Wife এর নাম এ। Policy অনুযায়ী কাস্টমার এর marriage certificate অথবা কাস্টমার এর সন্তানের NID/ জন্ম নিবন্ধনের ছবি দিতে হবে (জন্ম নিবন্ধন https://bdbirthcertificatecheck.com/ এই ওয়েবসাইট থেকে চেক করে স্ক্রিনশট দিতে হবে ) ।","statement","return"],"stm.15":["মিনি স্টেটমেন্ট গ্রহণযোগ্য নয় ,ব্যাংক থেকে details স্টেটমেন্ট নিয়ে আসুন অথবা ব্যাংক এর apps থেকে details স্টেটমেন্ট ডাউনলোড করে pdf ফাইল submit করুন।","statement","return"],"stm.16":["কাস্টমার উনার স্বামীর /স্ত্রীর স্টেটমেন্ট দিয়েছে , তাই প্রয়োজনীয় সম্পর্ক প্রমাণ (ম্যারেজ সার্টিফিকেট / সন্তানের জন্ম নিবন্ধন / NID) সাবমিট করতে হবে, যা সাবমিট করা হয়নি অনুগ্রহ করে প্রয়োজনীয় তথ্য সহ রিসাবমিট করুন।","statement","return"],"stm.17":["হোয়াটসঅ্যাপ গ্রুপে কাস্টমারের bKash অ্যাপের একটি ভিডিও শেয়ার করুন, যেখানে নাম, নম্বর এবং লেনদেন স্পষ্টভাবে দেখা যায়।","statement","return"],"stm.18":["কাস্টমারের bKash স্টেটমেন্টে নাম show করছে না , নাম না থাকলে App login থেকে Statement download করে পাসওয়ার্ড দিয়ে ওপেন করা পর্যন্ত স্ক্রিন রেকর্ড করে whatsapp group এ সাবমিট করুন।","statement","return"],"stm.19":["কাস্টমারের Nagad স্টেটমেন্টে নাম show করছে না , নাম না থাকলে Nagad অ্যাপের একটি ভিডিও হোয়াটসঅ্যাপ গ্রুপে শেয়ার করুন, যেখানে নাম, নম্বর এবং লেনদেন স্পষ্টভাবে দেখা যায়। এবং Nagad থেকে যে ইমেইল এ স্টেটমেন্ট পাঠোনো হয়েছে সেটাও স্ক্রিনরেকর্ড করে পাঠান।","statement","return"],"stm.20":["গ্রাহকের বিকাশ স্টেটমেন্টটি অবশ্যই হতে হবে গ্রাহক কিংবা জামিনদারের নাম্বার দিয়ে লক করে পাসওয়ার্ড প্রটেক্ট করে দেওয়া , অনুগ্রহ করে সঠিকভাবে স্টেটমেন্টটি পাসওয়ার্ড লক করে দিয়ে সাবমিট করুন , ধন্যবাদ.","statement","return"],"stm.21":["অনুগ্রহ করে নগদ স্টেটমেন্ট এর লগইন এবং ট্রানসাকশান হিস্টোরি ভিডিও হোয়াটস্যাপ গ্রুপে সাবমিট করুন","statement","return"],"stm.22":["কাস্টমার স্যালারি স্লিপ দিয়েছেন এবং Business hour এর পরে আবেদন করেছেন। অনুগ্রহ করে আবেদন টি business hour (সকাল ৯ টা থেকে বিকেল ৫ টা) এর মধ্যে করার জন্য অনুরোধ করা হলো।","statement","return"],"stm.23":["কাস্টমার যে স্যালারি স্লিপ দিয়েছেন সেখানে কোম্পানি থেকে দেওয়া কোম্পানি এর পরিচিতি , স্যালারি স্লিপ যাচাই এর জন্য যোগাযোগের মাধ্যম , সিল এবং ওই ডিপার্টমেন্ট প্রধানের নাম পদবি সহ সাক্ষর থাকা লাগবে। যেটা এই স্যালারি স্লিপ এ নেই। তাই অনুগ্রহ করে কাস্টমার এর গত ৩ মাসের ({m3}) PDF বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট প্রদান করুন।","statement","return"],"stm.24":["গত ৩ মাসের ({m3}) স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি (আবেদন এর দিন থেকে গত ৭ দিন বাদ এ যে কোন এক মাসে ক্যাশ ইন অথবা ক্যাশ আউট (আলাদাভাবে, যোগ করে নয়) কমপক্ষে ২০০০ টাকা)। অনুগ্রহ করে গ্রাহকের অন্য স্টেটমেন্ট বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই স্টেটমেন্ট সাবমিট করুন।","statement","return"],"stm.25":["অনুগ্রহ করে গ্রাহকের স্টেটমেন্ট সাবমিট করবেন যখন ফাস্ট ব্লাডের (বাবা ,মা ,ভাই ,বোন ,স্ত্রী অথবা সন্তান) কেউ জামিনদার হিসেবে কিস্তির দায়ভার গ্রহণ করবেন না । অথবা তখনই ফার্স্ট ব্লাডের স্টেটমেন্ট গ্রহণযোগ্য হবে যখন ফার্স্ট ব্লাডের ব্যক্তি (বাবা ,মা ,ভাই ,বোন ,স্ত্রী অথবা সন্তান) জামিনদার হিসেবে দায়ভার গ্রহণ করবেন।","statement","return"],"stm.26":["যেহেতু কাস্টমার মায়ের বিকাশ স্টেটমেন্ট জমা দিয়েছেন,তাই মাকে জামিনদার হিসেবে দিতে হবে।","statement","return"],"stm.27":["যেহেতু কাস্টমার বাবার বিকাশ স্টেটমেন্ট জমা দিয়েছেন,তাই বাবাকে জামিনদার হিসেবে দিতে হবে।","statement","return"],"stm.28":["প্রদত্ত bkash statement কাস্টমার এর না, সঠিক স্টেট্মেন্ট প্রদান করুন।কাস্টমার অথবা তার বাবা-মা/ভাই-বোনের ব্যাংক/bKash/নগদ/রকেট স্টেটমেন্ট জমা দিন। (যার স্টেটমেন্ট দেওয়া হবে, তাকে গ্যারান্টর হিসেবে দিতে হবে)। non blood গ্যারেন্টর এর স্টেট্মেন্ট গ্রহনযোগ্য নয়","statement","return"],"stm.29":["শুধুমাত্র কাস্টমার ও গেরান্টরের নামের স্টেট্মেন্ট গ্রহনযোগ্য ।এক্ষেত্রে হয় গেরান্টর পরিবর্তন করতে হবে অথবা স্টেট্মেন্ট পরিবর্তন করতে হবে ।গেরান্টরের নামের স্টেট্মেন্ট প্রদান করলে, গেরান্টর অবশ্যই কাস্টমারের আপন ভাই ,বোন, মা, বাবা ,সন্তান,অথবা স্ত্রি হতে হবে । গেরান্টরের বয়স ২১-৬২ বছরের মধ্যে হতে হবে ।স্বামি /স্ত্রির স্টেট্মেন্ট ব্যাবহার করলে তাদের বিয়ের কাবিন নামা অথবা সন্তানের জন্ম সনদ প্রদান করুন।","statement","return"],"stm.30":["কাস্টমারের তার নিজের নামে অথবা তার বাবা-মা, ভাই-বোনের নামে স্টেটমেন্ট দিতে হবে। সেক্ষেত্রে, যার নামে স্টেটমেন্ট দেওয়া হচ্ছে তাকে জামিনদার দিতে হবে।","statement","return"]};

  const DEFAULT_POLICY = {
    customer_age_min: 19,
    customer_age_max: 62,
    guarantor_age_min: 21,
    guarantor_age_max: 62,
    age_tolerance_years: 0.5,
    statement_months: 3,
    min_month_tx: 2000,
    fast_track_tx: 6000,
    money_tolerance: 60,
    exclude_last_days: 7,
    mrp_factor: 0.9,
    high_mrp: 50000,
    high_mrp_tx3: 15000,
    tx3_exempt: 30000,
    dp_exempt_pct: 40,
    dp40_short_guarantor_call: true,
    salary_exempt: 25000,
    rental_income_min: 25000,
    business_start: 9,
    business_end: 17,
    weekend_days: [4, 5],
    first_blood: ["father", "mother", "son", "daughter", "brother", "sister"],
    not_served: ["media_press", "ngo_loan", "competitor", "defense", "lawyer", "disabled"],
  };

  const NOT_SERVED = {
    media_press: "Media / press worker",
    ngo_loan: "Staff of a loan-providing NGO",
    competitor: "Employee of another mobile installment / phone brand / competitor",
    defense: "Defense-related person (military, police, etc.)",
    lawyer: "Lawyer",
    disabled: "Person with disability (blind, deaf, physical or intellectual)",
  };

  const STATUS_APPROVED = "APPROVED";
  const STATUS_ACTION = "ACTION REQUIRED";
  const STATUS_RETURNED = "RETURNED";
  const STATUS_REJECTED = "REJECTED / SUSPECTED FRAUD";
  const STATUS_NEED_INFO = "MORE INFO NEEDED";

  const TID = {
    tx_month: "stm.04",
    tx3_15k: "job.02",
    slip_hours: "stm.22",
    slip_bad: "stm.23",
    nid_name_c: "nid.09",
    nid_name_g: "nid.10",
    office_phone: "con.15",
    g_no_prof: "gua.09",
    nid_orig: "nid.02",
    g_not_family: "gua.05",
    spouse_proof: "stm.16",
    g_age_high: "gua.02",
    g_age_low: "gua.04",
    job_id: "job.01",
    lic_none: "biz.01",
    lic_expired: "biz.03",
    rider: "biz.06",
    landowner: "biz.07",
    stmt_not_3_months: "stm.01",
    rel_reject: "rej.28",
    not_served: "rej.29",
    outside_area: "rej.30",
    age_customer: "rej.31",
  };

  const FLAG_TID = {
    is_nid_edited: "rej.23",
    nid_parent_names_edited: "rej.11",
    nid_ai_fake: "rej.05",
    nid_not_in_portal: "rej.09",
    nid_photo_mismatch: "rej.15",
    voice_mismatch: "rej.06",
    customer_not_interested: "rej.16",
    guarantor_nid_edited: "rej.24",
    guarantor_nid_not_in_portal: "rej.13",
    guarantor_nid_no_sign: "rej.17",
    guarantor_nid_ears: "rej.19",
    is_statement_edited: "rej.25",
    palmpay_edited: "rej.14",
    palmpay_overdue: "rej.26",
    repeated_resubmit: "rej.18",
    call_info_unverifiable: "rej.27",
  };
  const REJECT_FLAGS = Object.keys(FLAG_TID);

  const FIELDS = [
    "mrp", "customer_age", "guarantor_age", "profession", "guarantor_profession",
    "tx_1_month", "tx_3_month", "down_payment_pct", "monthly_salary", "rental_income",
    "has_original_nid", "name_mismatch", "nid_name_mismatch", "guarantor_nid_name_mismatch",
    "office_phone_number", "repeat_customer",
    "guarantor_relation", "spouse_proof", "relation_check", "side_prompting",
    "outside_address_area", "salary_slip_submitted", "salary_slip_handwritten",
    "submission_datetime", "submission_note", "job_id_status", "trade_license_status",
    "has_shop_photos", "statement_in_business_name", "stmt_months_covered",
    ...REJECT_FLAGS,
  ];

  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
  const BN_RE = /[\u0980-\u09FF]/;

  function effectivePolicy(pol) {
    const v = Object.assign({}, DEFAULT_POLICY, pol || {});
    v.customer_age = [v.customer_age_min, v.customer_age_max];
    v.guarantor_age = [v.guarantor_age_min, v.guarantor_age_max];
    v.business_hours = [v.business_start, v.business_end];
    v.weekend_days_set = new Set(Array.isArray(v.weekend_days) ? v.weekend_days : [4, 5]);
    v.first_blood_set = new Set(Array.isArray(v.first_blood) ? v.first_blood : DEFAULT_POLICY.first_blood);
    v.not_served_set = new Set(Array.isArray(v.not_served) ? v.not_served : DEFAULT_POLICY.not_served);
    return v;
  }

  function fmtInt(n) {
    return Math.round(Number(n)).toLocaleString("en-US");
  }

  function fmtNum0(n) {
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function tplContext(pol, nowMs) {
    const C = effectivePolicy(pol);
    const d = new Date((nowMs != null ? nowMs : Date.now()) + 6 * 3600 * 1000);
    const m = d.getUTCMonth();
    const idx = [3, 2, 1].map((k) => ((m - k) % 12 + 12) % 12);
    const en = idx.map((i) => MONTHS_EN[i]);
    const bn = idx.map((i) => MONTHS_BN[i]);
    return {
      m3: en.join(", "),
      m3_bn: bn.join(", "),
      m3_bn_sp: bn.join(" "),
      m1_bn: bn[0],
      m1: en[0],
      c_age_min: C.customer_age_min,
      c_age_max: C.customer_age_max,
      g_age_min: C.guarantor_age_min,
      g_age_max: C.guarantor_age_max,
      min_tx: fmtInt(C.min_month_tx),
      fast_tx: fmtInt(C.fast_track_tx),
      high_mrp: fmtInt(C.high_mrp),
      dp_pct: C.dp_exempt_pct,
      months: C.statement_months,
    };
  }

  function renderTemplate(text, params, ctx) {
    if (!text) return text;
    const vals = Object.assign({}, ctx || {}, params || {});
    return String(text).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, k) =>
      Object.prototype.hasOwnProperty.call(vals, k) && vals[k] !== undefined && vals[k] !== null ? String(vals[k]) : full
    );
  }

  function buildTemplateLookup(tplCatalog) {
    const map = new Map();
    for (const [tid, arr] of Object.entries(BUILTIN_COMPACT)) {
      map.set(tid, { text: arr[0], section: arr[1], kind: arr[2], hidden: false });
    }
    if (tplCatalog && Array.isArray(tplCatalog.sections)) {
      for (const sec of tplCatalog.sections) {
        for (const it of (sec.items || [])) {
          if (!it || !it.id) continue;
          map.set(it.id, {
            text: it.text,
            section: sec.id,
            kind: sec.kind,
            hidden: !!it.hidden,
          });
        }
      }
    }
    return map;
  }

  const _num = (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const _flag = (v) => v === true;
  const _ge = (val, thr, C) => val !== null && val >= thr - C.money_tolerance;

  function _fmtAge(a) {
    let y = Math.floor(a);
    let m = Math.round((a - y) * 12);
    if (m === 12) { y += 1; m = 0; }
    return `${y}y ${m}m`;
  }

  function _exemptKnown(d, C) {
    const tx3 = _num(d.tx_3_month) || 0;
    const sal = _num(d.monthly_salary) || 0;
    const dp = _num(d.down_payment_pct) || 0;
    return (
      dp >= C.dp_exempt_pct ||
      _ge(tx3, C.tx3_exempt, C) ||
      ((d.profession === "job_holder" || d.profession === "student") &&
        d.salary_slip_submitted === true &&
        _ge(sal, C.salary_exempt, C))
    );
  }

  function _dpRelax(d, C) {
    const mrp = _num(d.mrp);
    const dp = _num(d.down_payment_pct);
    return Boolean(C.dp40_short_guarantor_call && mrp !== null && mrp < C.high_mrp && dp !== null && dp >= C.dp_exempt_pct);
  }

  function _outsideHours(dtStr, note, C) {
    if (note === "evening" || note === "weekend" || note === "holiday") return `submitted on ${note}`;
    if (dtStr) {
      const s = String(dtStr).replace("Z", "");
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
      if (m) {
        const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
        const pyWeekday = (dt.getUTCDay() + 6) % 7;
        if (C.weekend_days_set.has(pyWeekday)) return "submitted on a weekend";
        const hr = +m[4];
        const [start, end] = C.business_hours;
        if (!(start <= hr && hr < end)) return `submitted outside business hours (${m[4]}:${m[5]})`;
      }
    }
    return null;
  }

  function findMissing(d, pol) {
    const C = effectivePolicy(pol);
    const q = [];
    const mrp = _num(d.mrp);
    const prof = d.profession;
    const tx3 = _num(d.tx_3_month);
    const best = _num(d.tx_1_month);

    if (_num(d.customer_age) === null) q.push(["customer_age", "Customer-er boyos koto?"]);
    if (prof == null) q.push(["profession", "Customer-er peshha ki? (job holder / student / businessman / rider / house owner / beker / onno)"]);
    if (mrp === null) q.push(["mrp", "MRP koto taka?"]);
    if (prof === "unemployed" && d.guarantor_profession == null) {
      q.push(["guarantor_profession", "Customer beker - guarantor-er peshha ki? (peshha thakte hobe)"]);
    }
    const isHighMrp = mrp !== null && mrp >= C.high_mrp;
    if (best === null && !isHighMrp) {
      q.push(["tx_1_month", "Shobcheye bhalo 1 mash-er bKash/Nagad/bank transaction koto? (Debit + Credit / cash-in + cash-out miliye)"]);
    }
    if (d.name_mismatch === true && d.guarantor_relation == null) {
      q.push(["guarantor_relation", "Name mismatch ache - guarantor customer-er ke hoy? (father/mother/brother/sister/spouse/onno)"]);
    }
    if (d.guarantor_relation === "spouse" && d.name_mismatch === true && d.spouse_proof == null) {
      q.push(["spouse_proof", "Spouse-er jonno marriage certificate ba child-er NID/QR birth certificate ache?"]);
    }

    if (mrp !== null && mrp >= C.high_mrp && prof) {
      const dp = _num(d.down_payment_pct);
      if (prof === "job_holder" || prof === "student" || prof === "businessman") {
        if (tx3 === null) q.push(["tx_3_month", `MRP ${fmtInt(C.high_mrp)}+; 3 mash-er total transaction (cash-in + cash-out jog kore) koto?`]);
      }
      if (prof === "rider" || prof === "house_owner") {
        if (dp === null && !(prof === "house_owner" && _ge(_num(d.rental_income) || 0, C.rental_income_min, C))) {
          q.push(["down_payment_pct", "Down payment koto %?"]);
        }
      }
      if (prof === "house_owner" && _num(d.rental_income) === null && dp === null) {
        q.push(["rental_income", "Mashik rental income koto?"]);
      }
      if ((prof === "job_holder" || prof === "student") && !_exemptKnown(d, C)) {
        if (d.job_id_status == null) q.push(["job_id_status", "Original Job ID card (hard copy) ache? (original / photocopy / none / work_photo / visiting_card)"]);
        if (dp === null && (d.job_id_status == null || d.job_id_status === "photocopy")) q.push(["down_payment_pct", "Down payment koto %?"]);
      }
      if (prof === "businessman" && !_exemptKnown(d, C)) {
        const lic = d.trade_license_status;
        if (lic == null) q.push(["trade_license_status", "Trade license-er obostha? (valid / expired / none)"]);
        if (lic === "expired" && d.has_shop_photos == null) q.push(["has_shop_photos", "Signboard shoho 2-ta shop photo + cash counter-e owner-er photo ache?"]);
        if ((lic == null || lic === "none") && dp === null) q.push(["down_payment_pct", "Down payment koto %?"]);
      }
    }

    const seen = new Set();
    const out = [];
    for (const [k, v] of q) {
      if (!seen.has(k)) { seen.add(k); out.push([k, v]); }
    }
    return out;
  }

  function combineStatus(auto, manual, dismissed, missing) {
    const disSet = new Set(dismissed || []);
    const man = manual || [];
    const activeAuto = (auto || []).filter((r) => !disSet.has(r.key));
    const kinds = activeAuto.map((r) => r.kind).concat(man.map((m) => m.kind));
    let status;
    if (kinds.includes("reject")) status = STATUS_REJECTED;
    else if (kinds.includes("return")) status = STATUS_RETURNED;
    else if (missing && missing.length) status = STATUS_NEED_INFO;
    else if (kinds.includes("action")) status = STATUS_ACTION;
    else status = STATUS_APPROVED;
    return {
      status,
      active: {
        reject: kinds.filter((k) => k === "reject").length,
        return: kinds.filter((k) => k === "return").length,
        action: kinds.filter((k) => k === "action").length,
      },
      dismissed: [...disSet].filter((k) => (auto || []).some((r) => r.key === k)).sort(),
    };
  }

  function evaluateApplication(rawData, pol) {
    const C = effectivePolicy(pol);
    const d = {};
    for (const k of FIELDS) d[k] = rawData && Object.prototype.hasOwnProperty.call(rawData, k) ? rawData[k] : null;

    const reasons = [];
    const ok = [];
    const notes = [];
    let fastTrack = false;
    const R = (kind, key, why, tid = null, params = {}) => reasons.push({ key, kind, tid, params, why });

    const prof = d.profession;
    const gprof = d.guarantor_profession;
    const mrp = _num(d.mrp);
    const tx3 = _num(d.tx_3_month);
    const dp = _num(d.down_payment_pct);
    const cage = _num(d.customer_age);
    const gage = _num(d.guarantor_age);

    for (const field of REJECT_FLAGS) {
      if (_flag(d[field])) R("reject", "flag:" + field, `Red-flag checkbox ticked: ${field}`, FLAG_TID[field]);
    }
    for (const [who, p] of [["Customer", prof], ["Guarantor", gprof]]) {
      if (p && NOT_SERVED[p] && C.not_served_set.has(p)) {
        R("reject", `not_served:${who.toLowerCase()}`, `${who} is in a NOT SERVED category: ${NOT_SERVED[p]}`,
          TID.not_served, { who, category: NOT_SERVED[p] });
      }
    }
    if (_flag(d.outside_address_area)) {
      R("reject", "outside_area", "Applicant is outside the served address area", TID.outside_area);
    }

    const tol = C.age_tolerance_years;
    const [clo, chi] = C.customer_age;
    if (cage !== null) {
      if (clo <= cage && cage <= chi) {
        ok.push(`Customer age ${_fmtAge(cage)} is within ${clo}-${chi}.`);
      } else if (clo - tol <= cage && cage <= chi + tol) {
        ok.push(`Customer age ${_fmtAge(cage)} accepted (within the ${(tol * 12).toFixed(0)}-month margin of ${clo}-${chi}).`);
        notes.push(`Customer age ${_fmtAge(cage)} is outside ${clo}-${chi} by less than ${(tol * 12).toFixed(0)} months - accepted.`);
      } else {
        R("reject", "customer_age", `Customer age ${_fmtAge(cage)} is outside ${clo}-${chi}.`,
          TID.age_customer, { age: _fmtAge(cage), range: `${clo}-${chi}` });
      }
    }

    const [glo, ghi] = C.guarantor_age;
    if (gage !== null) {
      if (glo <= gage && gage <= ghi) {
        ok.push(`Guarantor age ${_fmtAge(gage)} is within ${glo}-${ghi}.`);
      } else if (glo - tol <= gage && gage <= ghi + tol) {
        ok.push(`Guarantor age ${_fmtAge(gage)} accepted (within the ${(tol * 12).toFixed(0)}-month margin of ${glo}-${ghi}).`);
        notes.push(`Guarantor age ${_fmtAge(gage)} is outside ${glo}-${ghi} by less than ${(tol * 12).toFixed(0)} months - accepted.`);
      } else if (gage > ghi) {
        R("return", "guarantor_age", `Guarantor age ${_fmtAge(gage)} is above ${ghi} - guarantor must be changed.`, TID.g_age_high);
      } else {
        R("return", "guarantor_age", `Guarantor age ${_fmtAge(gage)} is below ${glo} - guarantor must be changed.`, TID.g_age_low);
      }
    }

    const months = _num(d.stmt_months_covered);
    const needM = C.statement_months;
    if (months !== null) {
      if (months < needM) {
        R("return", "stmt_not_3_months", `The statement covers only ${months.toFixed(0)} of the last ${needM} months.`, TID.stmt_not_3_months);
      } else {
        ok.push(`The statement covers the last ${needM} months.`);
      }
    }

    const best = _num(d.tx_1_month);
    const isHighMrp = mrp !== null && mrp >= C.high_mrp;
    if (best !== null) {
      if (!isHighMrp) {
        if (_ge(best, C.min_month_tx, C)) {
          ok.push(`At least one month has combined Debit + Credit (cash-in + cash-out) of BDT ${fmtInt(C.min_month_tx)} or more (best month ${fmtNum0(best)}).`);
        } else {
          R("return", "tx_month",
            `No month reaches BDT ${fmtInt(C.min_month_tx)} in combined cash-in + cash-out (best month ${fmtNum0(best)}); ` +
            `the last ${C.exclude_last_days} days before the application are not counted. Ask for another statement.`,
            TID.tx_month);
        }
      }
      if (_ge(best, C.fast_track_tx, C)) fastTrack = true;
    }
    if (d.name_mismatch === false && (best !== null || _num(d.tx_3_month) !== null)) {
      notes.unshift("Customer Statement verified: Guarantor-কে শুধু Missed Call দিলেই হবে (missed call to guarantor is enough).");
    }
    notes.push(`Statement must cover the last ${C.statement_months} months; the last ${C.exclude_last_days} days before application ` +
      `are not counted. Cash-in + Cash-out (Debit + Credit) combined is counted for the ${fmtInt(C.min_month_tx)} / ${fmtInt(C.fast_track_tx)} / 15k / 30k rules.`);

    const rc = d.relation_check;
    const prompting = _flag(d.side_prompting);
    if (rc === "major") {
      R("reject", "relation_major", "Customer and guarantor gave inconsistent relationship information.", TID.rel_reject);
    } else if (rc === "pending" && !prompting) {
      R("action", "relation_pending",
        "Relationship answer is slightly different (e.g. chachato vs fufato bhai). The customer may be nervous - give ONE " +
        "chance to correct it, without hinting the answer. If corrected: accepted. If still different: reject.");
    } else if (rc === "corrected" && !prompting) {
      ok.push("Small relationship slip was corrected by the customer himself - accepted.");
    }
    if (prompting) {
      const extra = rc === "corrected" ? " The correction came while someone was prompting, so it does not count - ask again." : "";
      R("action", "side_prompting",
        "Someone nearby is telling the answers. Tell them to stop. Do not accept answers the customer repeats after " +
        "hearing them - ask again so the customer answers on his own." + extra);
    }

    const mt = C.money_tolerance;
    const pairs = [
      ["Best month (cash-in or cash-out)", best, C.min_month_tx],
      ["Best month (Fast-Track)", best, C.fast_track_tx],
    ];
    if (mrp !== null && mrp >= C.high_mrp) {
      if (prof === "job_holder" || prof === "student" || prof === "businessman") {
        pairs.push(["3-month transaction", tx3, C.high_mrp_tx3]);
        pairs.push(["3-month transaction (exemption)", tx3, C.tx3_exempt]);
      }
      if (prof === "job_holder" || prof === "student") pairs.push(["Monthly salary", _num(d.monthly_salary), C.salary_exempt]);
      if (prof === "house_owner") pairs.push(["Rental income", _num(d.rental_income), C.rental_income_min]);
    }
    for (const [label, v, thr] of pairs) {
      if (v !== null && thr - mt <= v && v < thr) {
        notes.push(`${label} ${fmtNum0(v)} is BDT ${fmtNum0(thr - v)} short of ${fmtInt(thr)} - accepted (margin: BDT ${mt}).`);
      }
    }

    if (d.has_original_nid === false) {
      R("return", "nid_orig", "Customer must provide the ORIGINAL NID (photocopy not accepted for customer).", TID.nid_orig);
    }
    if (_flag(d.nid_name_mismatch)) R("return", "nid_name_c", "Customer name does not match the NID.", TID.nid_name_c);
    if (_flag(d.guarantor_nid_name_mismatch)) R("return", "nid_name_g", "Guarantor name does not match the NID.", TID.nid_name_g);
    if (_flag(d.office_phone_number)) {
      R("return", "office_phone", "An official/office phone number was given - a personal mobile number is required.", TID.office_phone);
    }
    if (prof === "unemployed") {
      if (gprof === "unemployed") {
        R("return", "g_no_prof", "Customer is unemployed, so the guarantor must have a profession - guarantor has none.", TID.g_no_prof);
      } else if (gprof) {
        ok.push("Customer is unemployed, but the guarantor has a profession.");
      }
    }
    if (_dpRelax(d, C)) {
      notes.push(`${C.dp_exempt_pct}%+ down payment on MRP below ${fmtInt(C.high_mrp)}: no need to ask the guarantor many questions on the call - ` +
        "keep it short (phone reachable, knows the customer). All document checks stay the same.");
    }
    if (_flag(d.repeat_customer)) {
      notes.push("Repeat customer: do not ask many questions on the call - do a short verification and finish.");
    }

    if (_flag(d.salary_slip_submitted)) {
      const why = _outsideHours(d.submission_datetime, d.submission_note, C);
      if (why) {
        R("return", "slip_hours", `Salary slip ${why} - cannot be verified (business hours: ${C.business_hours[0]}:00 - ${C.business_hours[1]}:00, working days).`, TID.slip_hours);
      }
      if (_flag(d.salary_slip_handwritten)) {
        R("return", "slip_bad", "Salary slip has a handwritten signature/seal - an official company seal is required.", TID.slip_bad);
      }
    }

    if (_flag(d.name_mismatch)) {
      const rel = d.guarantor_relation;
      if (rel && C.first_blood_set.has(rel)) {
        ok.push(`Name mismatch is acceptable: guarantor is first-blood relative (${rel}).`);
      } else if (rel === "spouse") {
        if (d.spouse_proof === "marriage_certificate" || d.spouse_proof === "child_nid" || d.spouse_proof === "qr_birth_certificate") {
          ok.push("Name mismatch is acceptable: spouse with valid proof.");
        } else {
          R("return", "spouse_proof", "Spouse statement needs a marriage certificate OR the children's NID / QR birth certificate.", TID.spouse_proof);
        }
      } else if (rel != null) {
        R("return", "g_not_family", "Name mismatch: guarantor must be a first-blood relative or a spouse with proof. Change the guarantor.", TID.g_not_family);
      }
    } else if (d.guarantor_relation === "spouse" && d.spouse_proof === "none") {
      R("return", "spouse_proof", "Wife-এর NID-তে স্বামীর নাম না থাকলে Marriage Certificate অথবা সন্তানের NID / Birth Certificate দিতে হবে।", TID.spouse_proof);
    }

    if (mrp !== null) {
      if (mrp < C.high_mrp) {
        ok.push(`MRP below ${fmtInt(C.high_mrp)} - basic requirements apply.`);
        if (_flag(d.statement_in_business_name) && d.trade_license_status !== "valid") {
          R("action", "lic_business_stmt", "Statement is in a business name - a VALID trade license is required.", TID.lic_none);
        }
      } else {
        const sug = `Otherwise reduce MRP below ${fmtInt(C.high_mrp)}.`;
        const dpOk = dp !== null && dp >= C.dp_exempt_pct;
        if (prof === "job_holder" || prof === "student") {
          if (tx3 !== null) {
            if (_ge(tx3, C.high_mrp_tx3, C)) ok.push(`3-month transaction ${fmtNum0(tx3)} >= ${fmtInt(C.high_mrp_tx3)}.`);
            else R("action", "tx3_15k", `3-month transaction ${fmtNum0(tx3)} is below ${fmtInt(C.high_mrp_tx3)}. Reduce MRP below ${fmtInt(C.high_mrp)}.`, TID.tx3_15k);
          }
          const jid = d.job_id_status;
          if (_exemptKnown(d, C)) {
            ok.push(`Job ID not required (down payment >= ${C.dp_exempt_pct}% / 3-month tx >= ${fmtInt(C.tx3_exempt)} / valid salary slip > ${fmtInt(C.salary_exempt)}).`);
          } else if (jid === "original") {
            ok.push("Original Job ID card (hard copy) provided.");
          } else if (jid === "work_photo" || jid === "visiting_card") {
            ok.push("No ID card, but work photo / visiting card accepted.");
          } else if (jid === "photocopy" || jid === "none" || jid != null) {
            R("action", "job_id", "Original Job ID card (hard copy) required - scan/photocopy not accepted. No ID? Work photo or visiting card is accepted. " + sug, TID.job_id);
          }
        } else if (prof === "businessman") {
          if (tx3 !== null) {
            if (_ge(tx3, C.high_mrp_tx3, C)) ok.push(`3-month transaction ${fmtNum0(tx3)} >= ${fmtInt(C.high_mrp_tx3)}.`);
            else R("action", "tx3_15k", `3-month transaction ${fmtNum0(tx3)} is below ${fmtInt(C.high_mrp_tx3)}. Reduce MRP below ${fmtInt(C.high_mrp)}.`, TID.tx3_15k);
          }
          const lic = d.trade_license_status;
          if (_exemptKnown(d, C) && lic !== "valid") {
            ok.push(`Trade license not required (down payment >= ${C.dp_exempt_pct}% or 3-month tx >= ${fmtInt(C.tx3_exempt)}).`);
          } else if (lic === "valid") {
            ok.push("Valid trade license provided.");
          } else if (lic === "expired") {
            if (d.has_shop_photos === true) ok.push("License expired, but 2 shop photos (signboard + owner at cash counter) provided.");
            else if (d.has_shop_photos === false) R("action", "lic_expired", "License expired: take at least 2 shop photos with signboard and the owner at the cash counter.", TID.lic_expired);
          } else if (lic === "none") {
            R("action", "lic_none", `Valid trade license required (or down payment >= ${C.dp_exempt_pct}%, or 3-month tx >= ${fmtInt(C.tx3_exempt)}). ` + sug, TID.lic_none);
          }
        } else if (prof === "rider") {
          if (dpOk) ok.push(`Rider: down payment >= ${C.dp_exempt_pct}%.`);
          else if (dp !== null) R("action", "rider", `Rider needs ${C.dp_exempt_pct}%+ down payment (got ${dp.toFixed(0)}%). Otherwise eligible for MRP below ${fmtInt(C.high_mrp)} only.`, TID.rider);
        } else if (prof === "house_owner") {
          const rent = _num(d.rental_income);
          if (_ge(rent, C.rental_income_min, C)) ok.push(`House owner: rental income ${fmtNum0(rent)} >= ${fmtInt(C.rental_income_min)} - may apply for MRP >= ${fmtInt(C.high_mrp)} (proof required).`);
          else if (dpOk) ok.push(`House owner: down payment >= ${C.dp_exempt_pct}%.`);
          else if (dp !== null || rent !== null) R("action", "landowner", `House owner needs rental-income proof >= ${fmtInt(C.rental_income_min)}/month OR ${C.dp_exempt_pct}%+ down payment. ` + sug, TID.landowner);
        } else {
          R("action", "prof_no_match", `Profession does not match any MRP >= ${fmtInt(C.high_mrp)} category. Reduce MRP below ${fmtInt(C.high_mrp)}.`);
        }
      }
    }

    const missing = findMissing(d, C);
    return {
      reasons,
      passed: ok,
      notes,
      missing,
      fast_track: fastTrack,
      fast_track_msg: fastTrack
        ? "Fast-Track Guarantor Check: ask only 2 questions - (1) Is the guarantor's phone reachable? (2) Does the guarantor know the customer?"
        : "",
      status: combineStatus(reasons, [], [], missing).status,
    };
  }

  function buildCase(data, manual, dismissed, opts) {
    const pol = (opts && opts.policy) || null;
    const tplLookup = buildTemplateLookup(opts && opts.templates);
    const ctx = tplContext(pol, opts && opts.nowMs);
    const res = evaluateApplication(data || {}, pol);

    const cleanMan = [];
    const seen = new Set();
    for (const m of (manual || []).slice(0, 60)) {
      const tid = m && typeof m === "object" ? m.tid : m;
      if (typeof tid !== "string" || seen.has(tid)) continue;
      const meta = tplLookup.get(tid);
      if (meta && !meta.hidden) {
        seen.add(tid);
        let kind = meta.kind;
        const want = m && typeof m === "object" ? m.kind : null;
        if (want === "return" || want === "reject") {
          kind = want;
          if (kind === "reject" && BN_RE.test(meta.text || "")) kind = "return";
        }
        cleanMan.push({ tid, kind, section: meta.section });
      }
    }

    const dis = (dismissed || []).slice(0, 100).filter((k) => typeof k === "string" && k.length < 80);
    const disSet = new Set(dis);

    const reasons = [];
    for (const r of res.reasons) {
      const meta = r.tid ? tplLookup.get(r.tid) : null;
      const raw = meta ? meta.text : null;
      reasons.push({
        id: r.key,
        source: "auto",
        kind: r.kind,
        tid: r.tid,
        params: r.params,
        why: r.why,
        template: raw,
        text: raw ? renderTemplate(raw, r.params, ctx) : null,
        dismissed: disSet.has(r.key),
      });
    }
    for (const m of cleanMan) {
      const meta = tplLookup.get(m.tid);
      const raw = meta ? meta.text : "";
      reasons.push({
        id: "manual:" + m.tid,
        source: "manual",
        kind: m.kind,
        tid: m.tid,
        params: {},
        why: "Added by the reviewer",
        template: raw,
        text: renderTemplate(raw, {}, ctx),
        dismissed: false,
      });
    }

    const combo = combineStatus(res.reasons, cleanMan, dis, res.missing);
    return {
      api_version: 2,
      local: true,
      status: combo.status,
      status_detail: { active: combo.active, dismissed: combo.dismissed },
      reasons,
      passed: res.passed,
      notes: res.notes,
      missing: res.missing,
      fast_track: res.fast_track,
      fast_track_msg: res.fast_track_msg,
      context: ctx,
    };
  }

  return {
    DEFAULT_POLICY,
    FIELDS,
    effectivePolicy,
    tplContext,
    renderTemplate,
    buildTemplateLookup,
    evaluateApplication,
    combineStatus,
    buildCase,
  };
});
