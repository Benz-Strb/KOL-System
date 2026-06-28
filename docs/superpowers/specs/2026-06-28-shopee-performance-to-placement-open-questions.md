# Sync ผล Shopee เข้า placement ที่ว่าง — คำถามค้าง (รอ input)

> สถานะ: **brainstorming ค้างไว้** (2026-06-28) — รอคำตอบจากทีม/แหล่งข้อมูลก่อนออกแบบต่อ
> เป้าหมาย: เติม performance ของ Shopee เข้า placement ที่ posted แล้วแต่ยังไม่มีข้อมูล โดยใช้ข้อมูลที่มีใน `offplatform_traffic_daily`

---

## 1. สิ่งที่อยากทำ

เอาข้อมูลใน `offplatform_traffic_daily` (ผลโฆษณานอกแพลตฟอร์ม FB/Google → Shopee) มาเติมให้ `placement` ที่ยังไม่มี performance ของ Shopee

---

## 2. สิ่งที่เช็คแล้ว (ข้อมูลจริง ไม่ต้อง derive ใหม่)

### สถานะ placement
- placement ทั้งหมด **1,237** · posted **964**
- มี shopee metric แล้ว **565** · **posted แต่ยังไม่มี shopee metric = 462** ← กลุ่มเป้าหมาย "ที่ว่าง"
- channel ที่มีใน `placement_metrics` ตอนนี้: `shopee | lazada | website` (บอทดึง)

### กุญแจ join (ข่าวดี — จับคู่ได้สะอาด)
- `placements` มีคอลัมน์ `utm_campaign_name` + `ad_content_name` อยู่แล้ว
- `offplatform_traffic_daily` key ด้วย `campaign_name` + `ad_content` + `channel` + `report_date`
- **คู่ (campaign + ad_content) ระบุ placement ได้ ~1:1**: 751 คู่ → 748 คู่ (99.6%) ชี้ placement เดียว (สูงสุดแค่ 2)
- ⚠️ ถ้า join ด้วย **campaign อย่างเดียวไม่ได้** — 150/181 campaign (83%) ใช้ร่วมหลาย placement สูงสุด 33 อัน → **ต้องใช้คู่ campaign+ad_content เสมอ**
- ฝั่ง offplatform (Dreame): มี **187 คู่** ที่ match placement ได้ 1 ต่อ 1

### ข้อจำกัด coverage (สำคัญ)
- `offplatform_traffic_daily` sync มาแค่ช่วง **2026-06-07 ถึง 06-21 (2 สัปดาห์)** · 4,023 แถว · 13 แบรนด์
- ในกลุ่ม 462 placement ที่ว่าง **มีแค่ 85 อันที่มี `utm_campaign_name`** → อีก ~377 อันไม่มี utm จะ map ไม่ได้เลย
- placement ที่ว่างส่วนใหญ่เป็น campaign เก่า ที่อยู่นอกช่วง 2 สัปดาห์ที่ sync มา → ต่อให้ map ได้ก็ไม่มีข้อมูลในตาราง
- **สรุป: จริงๆ เติมได้แค่หลักสิบ ไม่ใช่ทั้ง 462**

### ตัวเลขที่ offplatform ให้ได้ (ต่อ campaign+channel+วัน)
`visits, unique_visitors, add_to_cart_units, revenue_local, revenue_usd, orders, units_sold, buyers, new_buyers, conversion_rate`

---

## 3. ประเด็นนิยาม (หัวใจที่ต้องตัดสิน)

ลูกค้าซื้อของจากโพสต์ KOL บน Shopee ได้ 2 ทาง:
- **ทาง A** = เห็นโฆษณา FB/Google ที่เราจ่ายเงินบูสต์ → กดเข้า Shopee → ซื้อ
- **ทาง B** = กดลิงก์ KOL ตรงๆ (organic ไม่ผ่านโฆษณา) → ซื้อ

`offplatform_traffic_daily` **รู้แค่ทาง A** (ยอดจากโฆษณาที่จ่ายเงิน) ไม่เห็นทาง B เลย
→ ถ้าเอามาเติม จะได้แค่ "ยอดเฉพาะจากโฆษณา" ไม่ใช่ยอดขายรวมของโพสต์

---

## 4. ❓ คำถามที่ต้องไปถามต่อ (พรุ่งนี้)

1. **ตัวเลข shopee 565 อันที่มีอยู่ตอนนี้ มาจากไหน / นิยามอะไร?**
   - เป็น "ยอดรวมทั้งโพสต์ (A+B)" หรือ "เฉพาะยอดจากโฆษณา (A)" เหมือน offplatform?
   - (สำคัญ: ถ้านิยามต่างกันแล้วเก็บปนช่องเดียวกัน ตัวเลขใน dashboard จะเทียบกันไม่ได้)

2. **ยอด "เฉพาะจากโฆษณา (ทาง A)" รับได้ไหม?** หรือต้องการ "ยอดรวมจริง (A+B)"?
   - ถ้าต้องการ A+B → offplatform ให้ไม่ได้ ต้องหาแหล่ง/รายงาน Shopee อีกแบบ (เป็นแหล่งไหน? บอทตัวไหน?)

3. **offplatform จะ sync ย้อนหลัง / ต่อเนื่องได้ไหม?**
   - ตอนนี้มีแค่ 2 สัปดาห์ → ถ้าจะเติม placement เก่าๆ ต้อง sync ช่วงก่อนหน้าเข้ามาด้วย (BQ มีข้อมูลย้อนหลังแค่ไหน?)

4. **placement ที่ว่างแต่ "ไม่มี utm" (~377 อัน) จะเอา performance จากไหน?**
   - พวกนี้ map กับ offplatform ไม่ได้เลย — ปล่อยว่างต่อ หรือมีแผนอื่น?

---

## 5. การตัดสินใจ design ที่ค้าง (รอคำตอบข้อ 4 ด้านบนก่อน)

- **เก็บที่ไหน:** channel ใหม่ (เช่น `shopee_ads`) แยกจาก `shopee` เดิม **หรือ** เติมลง channel `shopee` เดิม?
  - แนวโน้ม/ข้อเสนอผม: **channel แยก** ตาม CLAUDE.md ข้อ 1 (ทับชั้นใหม่ ไม่ทับข้อมูลดิบเดิม) + กันนิยามปน
- **ระดับ aggregate:** รวมทุกวัน + ทุก channel ของคู่ (campaign+ad_content) เป็น 1 แถวต่อ placement?
- **is_automated flag / repost_id** จะตั้งค่ายังไง (ให้เข้ากับ pattern `placement_metrics` เดิม)

---

## 6. จุดกลับมาเริ่มต่อ

เมื่อได้คำตอบข้อ 4 ข้างบน → กลับมาที่ brainstorming เลือกแนวทาง (channel แยก vs เติมเดิม + scope coverage) → เขียน design doc → writing-plans

> หมายเหตุ: เรื่องนี้ต่างจาก "บอทดึง per-placement metrics" ใน CLAUDE.md TODO (ข้อ 10) ที่ยังไม่ทำ — offplatform เป็น **แหล่งข้อมูลคนละชั้น** ที่ "อาจใช้เป็น source" ของงานบอทนั้นได้ (เฉพาะ channel shopee, เฉพาะ placement ที่ boost ด้วย ad)
