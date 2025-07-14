/**
 * Import function triggers from their respective submodules:
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 */

// const {onRequest} = require("firebase-functions/v2/https"); // ❌ 미사용
// const logger = require("firebase-functions/logger"); // ❌ 미사용

const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

const modeMap = {
  "스마트 케어 모드": 0,
  "습식 모드": 1,
  "건식 모드": 2,
  "표준 모드": 3,
};
const modeMapRev = {
  0: "스마트 케어 모드",
  1: "습식 모드",
  2: "건식 모드",
  3: "표준 모드",
};

exports.recommendCleaningWeekly = onSchedule(
    {
      schedule: "0 0 * * 0", // 매주 일요일 0시 0분 실행
      timeZone: "Asia/Seoul",
    },
    async (event) => {
      const uid = "gg459WiR7veiSbKLXi2ZzlXTNL03";
      const vacuumId = "WJ772";

      const cleanHistorySnapshot = await db
          .collection("users")
          .doc(uid)
          .collection("robot_settings")
          .doc(vacuumId)
          .collection("cleanhistory")
          .get();

      if (cleanHistorySnapshot.empty) {
        console.log("청소 기록이 없습니다.");
        return null;
      }

      const dataList = [];

      cleanHistorySnapshot.forEach((doc) => {
        const data = doc.data();
        const startTime = data.startTime.toDate(); // Timestamp 타입일 경우만 작동
        const weekday = startTime.getDay();
        const hour = startTime.getHours();

        const modeEncoded = data.mode in modeMap ? modeMap[data.mode] : -1;
        const crumbCare = data["부스러기 집중 케어"] ? 1 : 0;
        const greaseCare = data["기름때 집중 케어"] ? 1 : 0;
        const waterCare = data["물때 집중 케어"] ? 1 : 0;

        dataList.push({
          weekday, hour, mode: modeEncoded, crumbCare, greaseCare, waterCare});
      });

      if (dataList.length === 0) {
        console.log("처리할 데이터가 없습니다.");
        return null;
      }

      const groupMap = new Map();
      dataList.forEach((item) => {
        const key = [
          item.mode,
          item.crumbCare,
          item.greaseCare,
          item.waterCare,
          item.weekday,
          item.hour,
        ].join("|");
        groupMap.set(key, (groupMap.get(key) || 0) + 1);
      });

      const sortedGroups = Array.from(groupMap.entries())
          .map(([key, count]) => {
            const [mode, crumbCare,
              greaseCare, waterCare, weekday,
              hour] = key.split("|").map(Number);
            return {mode, crumbCare, greaseCare,
              waterCare, weekday, hour, count};
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);

      const totalCount = dataList.length;

      const modeSumMap = new Map();
      const modeCountMap = new Map();

      dataList.forEach(({mode, crumbCare, greaseCare, waterCare}) => {
        if (!modeSumMap.has(mode)) {
          modeSumMap.set(mode, {crumbCare: 0, greaseCare: 0, waterCare: 0});
          modeCountMap.set(mode, 0);
        }
        const sums = modeSumMap.get(mode);
        sums.crumbCare += crumbCare;
        sums.greaseCare += greaseCare;
        sums.waterCare += waterCare;
        modeCountMap.set(mode, modeCountMap.get(mode) + 1);
      });

      const modeCareAvg = {};
      modeSumMap.forEach((sums, mode) => {
        const count = modeCountMap.get(mode);
        modeCareAvg[mode] = {
          crumbCare: sums.crumbCare / count,
          greaseCare: sums.greaseCare / count,
          waterCare: sums.waterCare / count,
        };
      });

      const batch = db.batch();
      const predictionCol = db
          .collection("users")
          .doc(uid)
          .collection("robot_settings")
          .doc(vacuumId)
          .collection("prediction");

      sortedGroups.forEach((item, index) => {
        const modeName = item.mode in
        modeMapRev ? modeMapRev[item.mode] : "알 수 없는 모드";
        const weekdayName = ["일요일", "월요일",
          "화요일", "수요일", "목요일", "금요일", "토요일"][item.weekday];
        const hour12 = item.hour % 12 === 0 ? 12 : item.hour % 12;
        const amPm = item.hour < 12 ? "오전" : "오후";
        const probability = item.count / totalCount;

        console.log(`[추천 ${index + 1}]`);
        console.log(`🔹 모드: ${modeName} (확률: ${probability.toFixed(2)})`);
        console.log(`🧼 집중케어 → 부스러기: ${item.crumbCare}, 
        오일: ${item.greaseCare}, 물때: ${item.waterCare}`);
        console.log(`요일: ${weekdayName}, 시간: ${amPm} ${hour12}시\n`);

        const docRef = predictionCol.doc();
        batch.set(docRef, {
          mode: modeName,
          probability,
          weekday: item.weekday,
          hour: item.hour,
          crumb_care: item.crumbCare,
          grease_care: item.greaseCare,
          water_care: item.waterCare,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
      console.log("추천 결과 Firestore에 저장 완료!");
      return null;
    },
);
