// 架空の名簿(8班x15軒=120世帯)を決定的に生成して stdout に出す。実名簿は扱わない。
const SEI = ["山田", "佐々木", "高橋", "渡辺", "伊藤", "中村", "小林", "加藤", "吉田", "山口", "松本", "井上", "木村", "林", "清水"];
const MEI = ["太郎", "花子", "一郎", "和子", "健二", "幸子", "進", "久美子"];
const LEADERS = ["青木 誠", "大野 恵", "森田 剛", "坂本 優", "福田 明", "藤井 実", "岡田 緑", "村上 勉"];

const groups = LEADERS.map((leader, g) => {
  const no = g + 1;
  const houses = Array.from({ length: 15 }, (_, i) => {
    const sei = SEI[(i + g * 4) % SEI.length];
    return {
      id: `g${no}-${String(i + 1).padStart(2, "0")}`,
      name: `${sei}家(${MEI[(i + g) % MEI.length]})`,
      // 3軒に1軒ほどは紙で参加(配置は班ごとにずらす)
      mode: (i + g) % 3 === 0 ? "paper" : "digital",
    };
  });
  return { id: `g${no}`, name: `${no}班`, leaders: [leader], passphrase: `hanchou-${no}`, houses };
});

console.log(JSON.stringify({ admin: { names: ["石田 正雄"], passphrase: "kaichou" }, groups }, null, 2));
