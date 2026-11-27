# TopPay Smart Decision Assistant — Chrome extension v3.17.0

## কী করে
- Audit detail page (`web.toppaybd.com/useraudit/detail/…`) খুলে ⚡ TP চাপুন (বা নিজে থেকে scan হয়)।
- ৪টা tab নিজে ঘুরে তথ্য পড়ে, ৫টা ফোন নম্বর (duplicate / খালি), NID-র দুই পাশ, NID ছবি থেকে **নম্বর + জন্মতারিখ** (OCR, আপনার কম্পিউটারেই) যাচাই করে।
- SOP rule ও BP message আসে **TopPay Smart Decision server** থেকে — তাই web app-এর Admin → "নীতি / Rules"-এ যা বদলাবেন (বয়স, ন্যূনতম লেনদেন, MRP সীমা…) extension-এও সেটাই চলবে।
- 📋 BP Msg = numbered BP-মেসেজ copy; ✍️ Fill = Audit Opinion box-এ বসানো। Internal note কখনো BP মেসেজে যায় না।
- 🌐 "পুরো Checker-এ খুলুন" = web app-এ সংখ্যাগুলো পাঠিয়ে বাকি যাচাই (statement, red flag) সেখানে করা।

## Privacy
Server-এ শুধু সংখ্যা/flag/template-id যায় (বয়স, MRP, পেশা, সম্পর্ক ইত্যাদি)। নাম, ফোন, NID নম্বর, ঠিকানা, ছবি **কখনো যায় না**। (node test `PRIVACY` এটা যাচাই করে।)

## Install
1. পুরোনো TopPay extension গুলো `chrome://extensions` থেকে **Remove** করুন (v1.x / v2.x)।
2. Zip extract করুন → `toppay-ext` folder।
3. `chrome://extensions` → Developer mode ON → **Load unpacked** → ওই folder।
4. Portal page-এ ⚡ TP → Shared ID/Password দিয়ে Login (admin যে ID/Password বানিয়েছেন)।
5. Server address default: `https://toppay-zeta.vercel.app` (⚙ থেকে বদলানো যায়)।

## জানা সীমাবদ্ধতা
- Portal-এর HTML আমি সরাসরি দেখতে পারিনি (login লাগে)। তাই scraping ঠিক সেই selector গুলো ব্যবহার করে যা আপনার কাজ করা v1.9/v2.2 ব্যবহার করত; test হয়েছে আমার বানানো mock page-এ। আসল page-এ কোনো ঘর না পড়লে "Case Data" tab-এ দেখুন কী পড়া গেছে।
- OCR ঝাপসা/তেরছা ছবিতে ভুল পড়তে পারে — তখন "unreadable" দেখায়, mismatch ধরা হয় না; হাতে বয়স লেখার ঘর আছে।
- Statement-এর টাকা এই extension-এ নেই — "আরো তথ্য দরকার"-এ হাতে লিখুন বা web app-এর Statement Checker ব্যবহার করুন।
- Web app-এ আপনার PC-তে করা template edit (local) extension-এ আসে না; Admin-এর global edit আসে।

## 🔔 Audit Alert (v3.16 থেকে এই extension-এই আছে)
- আলাদা "TopPay Audit Alert" extension আর লাগবে না — Remove করে দিন।
- Toolbar-এ extension icon চাপুন → **Alert ON** → beep সময় + Auto refresh (Search বাটন নিজে চাপে) ঠিক করুন।
- List পেজে Pending Check / Pending Review সংখ্যা বাড়লে beep + লাল banner। Banner-এ চাপলে বন্ধ।
- Case detail পেজে alert/auto-refresh কিছুই চলে না, তাই Smart Decision scan-এর সাথে ঝামেলা হয় না।
