/* As descrições dos comandos em cada língua que o Discord aceita.
 *
 * Arquivo de DADOS, como o catalogo.js. O index.js junta isto às definições
 * dos comandos (comLinguas) antes de publicar.
 *
 * QUEM ESCOLHE A LÍNGUA É O DISCORD, não a CYRON: a lista de comandos (o que
 * aparece ao digitar "/") sai no idioma do APLICATIVO de cada pessoa. O bot
 * não tem como mostrar um comando em japonês só para quem escolheu japonês no
 * /mylanguage. Mas quem lê japonês quase sempre usa o Discord em japonês, e
 * com a descrição em todas as línguas cada um lê na sua. As RESPOSTAS do bot
 * seguem a língua escolhida na CYRON, como sempre.
 *
 * Os NOMES dos comandos ficam como estão (/abraco, e /hug só em inglês e
 * espanhol): o nome é o que as pessoas dizem umas às outras ("usa /perfil") e
 * o que os textos do bot citam, e um nome diferente em cada língua poderia
 * não ser achado por quem procura o nome que leu. Os menus de botão direito
 * (Apps → Criar evento) ninguém digita: esses ganham o nome traduzido.
 *
 * O Discord não tem árabe nem filipino como língua do aplicativo: quem usa
 * essas línguas vê o texto padrão (português e inglês), em qualquer bot.
 *
 * Cada linha é L(pt, en, es, fr, de, it, nl, ru, uk, pl, tr, id, vi, th, hi,
 * ja, ko, zh), nessa ordem. Máximo de 100 letras por texto (o teste confere).
 */

const ORDEM = ["pt", "en", "es", "fr", "de", "it", "nl", "ru", "uk", "pl", "tr", "id", "vi", "th", "hi", "ja", "ko", "zh"];
const L = (...textos) => Object.fromEntries(ORDEM.map((l, i) => [l, textos[i]]));

/* Minha língua -> os códigos do Discord. */
export const LOCAIS_DO_DISCORD = {
  pt: ["pt-BR"], en: ["en-US", "en-GB"], es: ["es-ES", "es-419"], fr: ["fr"], de: ["de"], it: ["it"], nl: ["nl"],
  ru: ["ru"], uk: ["uk"], pl: ["pl"], tr: ["tr"], id: ["id"], vi: ["vi"], th: ["th"], hi: ["hi"], ja: ["ja"],
  ko: ["ko"], zh: ["zh-CN", "zh-TW"],
};

const EM_QUEM = L("Em quem", "Who", "A quién", "Qui", "Wen", "Chi", "Wie", "Кого", "Кого", "Kogo", "Kime", "Siapa", "Ai",
  "ใคร", "किसे", "相手", "대상", "对象");
const QUEM = L("Quem", "Who", "Quién", "Qui", "Wer", "Chi", "Wie", "Кто", "Хто", "Kto", "Kim", "Siapa", "Ai", "ใคร", "कौन",
  "対象", "대상", "对象");
const QUANTO = L("Quanto", "How much", "Cuánto", "Combien", "Wie viel", "Quanto", "Hoeveel", "Сколько", "Скільки", "Ile",
  "Ne kadar", "Berapa banyak", "Bao nhiêu", "เท่าไร", "कितना", "量", "양", "数量");
const QUAL_PERSONAGEM = L("Qual personagem", "Which character", "Qué personaje", "Quel personnage", "Welche Figur",
  "Quale personaggio", "Welk personage", "Какой персонаж", "Який персонаж", "Która postać", "Hangi karakter",
  "Karakter yang mana", "Nhân vật nào", "ตัวละครไหน", "कौन सा किरदार", "どのキャラクター", "어떤 캐릭터", "哪个角色");

/* Pelo caminho: "comando", "comando opção" ou "comando subcomando opção". */
export const DESCRICOES_DOS_COMANDOS = {
  cyron: L("Abrir o painel de configuração da CYRON", "Open CYRON's settings panel",
    "Abrir el panel de configuración de CYRON", "Ouvrir le panneau de configuration de CYRON",
    "CYRONs Einstellungsfenster öffnen", "Apri il pannello di configurazione di CYRON",
    "Het instellingenpaneel van CYRON openen", "Открыть панель настроек CYRON", "Відкрити панель налаштувань CYRON",
    "Otwórz panel ustawień CYRON", "CYRON ayar panelini aç", "Buka panel pengaturan CYRON", "Mở bảng cài đặt của CYRON",
    "เปิดแผงตั้งค่าของ CYRON", "CYRON का सेटिंग पैनल खोलें", "CYRONの設定パネルを開く", "CYRON 설정 패널 열기",
    "打开 CYRON 的设置面板"),
  help: L("Como usar a CYRON", "How to use CYRON", "Cómo usar CYRON", "Comment utiliser CYRON", "So benutzt du CYRON",
    "Come usare CYRON", "Zo gebruik je CYRON", "Как пользоваться CYRON", "Як користуватися CYRON", "Jak korzystać z CYRON",
    "CYRON nasıl kullanılır", "Cara memakai CYRON", "Cách dùng CYRON", "วิธีใช้ CYRON", "CYRON का इस्तेमाल कैसे करें",
    "CYRONの使い方", "CYRON 사용법", "如何使用 CYRON"),
  evento: L("Marcar um evento com hora", "Schedule an event with a time", "Programar un evento con hora",
    "Programmer un événement à une heure", "Ein Ereignis mit Uhrzeit planen", "Programma un evento con orario",
    "Een evenement met tijd plannen", "Запланировать событие на время", "Запланувати подію на час",
    "Zaplanuj wydarzenie na godzinę", "Saatli bir etkinlik planla", "Jadwalkan acara dengan waktu",
    "Lên lịch sự kiện theo giờ", "ตั้งเวลากิจกรรม", "समय के साथ इवेंट तय करें", "時間を決めてイベントを予定",
    "시간을 정해 이벤트 예약", "安排一个定时活动"),

  suporte: L("Liberar o suporte da CYRON para configurar o bot", "Let CYRON support set up the bot for you",
    "Permitir que el soporte de CYRON configure el bot", "Autoriser le support de CYRON à configurer le bot",
    "Dem CYRON-Support erlauben, den Bot einzurichten", "Permetti al supporto di CYRON di configurare il bot",
    "CYRON-support toestaan de bot in te stellen", "Разрешить поддержке CYRON настроить бота",
    "Дозволити підтримці CYRON налаштувати бота", "Pozwól wsparciu CYRON skonfigurować bota",
    "CYRON desteğinin botu kurmasına izin ver", "Izinkan dukungan CYRON mengatur bot", "Cho phép hỗ trợ CYRON cài đặt bot",
    "อนุญาตให้ทีมซัพพอร์ต CYRON ตั้งค่าบอท", "CYRON सपोर्ट को बॉट सेट करने की अनुमति दें",
    "CYRONサポートにボットの設定を許可する", "CYRON 지원팀이 봇을 설정하도록 허용", "允许 CYRON 支持团队设置机器人"),
  "suporte liberar": L("ADM: liberar o suporte da CYRON por um tempo", "Admin: allow CYRON support for a while",
    "Admin: permitir el soporte de CYRON por un tiempo", "Admin : autoriser le support de CYRON pour un temps",
    "Admin: CYRON-Support für eine Weile erlauben", "Admin: consenti il supporto di CYRON per un po'",
    "Beheerder: CYRON-support een tijdje toestaan", "Админ: разрешить поддержку CYRON на время",
    "Адмін: дозволити підтримку CYRON на час", "Admin: zezwól wsparciu CYRON na pewien czas",
    "Yönetici: CYRON desteğine bir süreliğine izin ver", "Admin: izinkan dukungan CYRON untuk sementara",
    "Quản trị: cho phép hỗ trợ CYRON trong một thời gian", "แอดมิน: อนุญาตซัพพอร์ต CYRON ชั่วคราว",
    "एडमिन: कुछ समय के लिए CYRON सपोर्ट की अनुमति दें", "管理者: 一定時間CYRONサポートを許可",
    "관리자: 일정 시간 CYRON 지원 허용", "管理员：在一段时间内允许 CYRON 支持"),
  "suporte liberar horas": L("Por quanto tempo", "For how long", "Por cuánto tiempo", "Pour combien de temps",
    "Für wie lange", "Per quanto tempo", "Voor hoe lang", "На какое время", "На який час", "Na jak długo",
    "Ne kadar süreyle", "Untuk berapa lama", "Trong bao lâu", "นานเท่าไร", "कितनी देर के लिए", "期間", "기간", "持续多久"),
  "suporte status": L("Até quando vale e o que foi mexido", "Until when, and what was changed",
    "Hasta cuándo vale y qué se cambió", "Jusqu'à quand, et ce qui a été modifié", "Bis wann, und was geändert wurde",
    "Fino a quando, e cosa è stato cambiato", "Tot wanneer, en wat er is gewijzigd", "До какого времени и что изменили",
    "До коли і що змінили", "Do kiedy i co zostało zmienione", "Ne zamana kadar ve neler değişti",
    "Sampai kapan, dan apa yang diubah", "Hiệu lực đến khi nào và đã thay đổi gì", "ใช้ได้ถึงเมื่อไร และแก้อะไรไปบ้าง",
    "कब तक, और क्या बदला गया", "期限と変更内容", "유효 기간과 변경된 내용", "有效期至何时，以及改了什么"),
  "suporte encerrar": L("ADM: cortar o acesso do suporte agora", "Admin: end support access now",
    "Admin: cortar el acceso del soporte ahora", "Admin : couper l'accès du support maintenant",
    "Admin: Support-Zugriff jetzt beenden", "Admin: termina subito l'accesso del supporto",
    "Beheerder: toegang van support nu beëindigen", "Админ: отключить доступ поддержки сейчас",
    "Адмін: припинити доступ підтримки зараз", "Admin: zakończ teraz dostęp wsparcia",
    "Yönetici: destek erişimini şimdi kapat", "Admin: hentikan akses dukungan sekarang",
    "Quản trị: ngắt quyền truy cập của hỗ trợ ngay", "แอดมิน: ยกเลิกสิทธิ์ซัพพอร์ตทันที",
    "एडमिन: सपोर्ट की पहुंच अभी बंद करें", "管理者: サポートのアクセスを今すぐ終了", "관리자: 지원 접근을 지금 종료",
    "管理员：立即结束支持访问"),
  "suporte abrir": L("Só o suporte da CYRON", "CYRON support only", "Solo el soporte de CYRON", "Réservé au support de CYRON",
    "Nur für den CYRON-Support", "Solo per il supporto di CYRON", "Alleen voor CYRON-support", "Только для поддержки CYRON",
    "Лише для підтримки CYRON", "Tylko dla wsparcia CYRON", "Yalnızca CYRON desteği için", "Khusus dukungan CYRON",
    "Chỉ dành cho hỗ trợ CYRON", "เฉพาะทีมซัพพอร์ต CYRON", "सिर्फ़ CYRON सपोर्ट के लिए", "CYRONサポート専用",
    "CYRON 지원팀 전용", "仅限 CYRON 支持团队"),

  duelo: L("Duelo de personagens da história", "Duel with characters from history", "Duelo de personajes de la historia",
    "Duel de personnages historiques", "Duell mit Figuren der Geschichte", "Duello tra personaggi della storia",
    "Duel met figuren uit de geschiedenis", "Дуэль исторических личностей", "Дуель історичних постатей",
    "Pojedynek postaci historycznych", "Tarihi karakterlerle düello", "Duel tokoh-tokoh sejarah",
    "Đấu tay đôi giữa các nhân vật lịch sử", "ดวลกับตัวละครในประวัติศาสตร์", "इतिहास के किरदारों का द्वंद्व",
    "歴史上の人物で決闘", "역사 속 인물들의 결투", "历史人物对决"),
  "duelo oponente": L("Contra quem (vazio: treino contra a CYRON)", "Opponent (empty: train against CYRON)",
    "Contra quién (vacío: entrenar contra CYRON)", "Adversaire (vide : entraînement contre CYRON)",
    "Gegner (leer: Training gegen CYRON)", "Avversario (vuoto: allenamento contro CYRON)",
    "Tegenstander (leeg: trainen tegen CYRON)", "Соперник (пусто: тренировка с CYRON)",
    "Суперник (порожньо: тренування з CYRON)", "Przeciwnik (puste: trening z CYRON)",
    "Rakip (boş: CYRON'a karşı antrenman)", "Lawan (kosong: latihan melawan CYRON)",
    "Đối thủ (để trống: luyện tập với CYRON)", "คู่ต่อสู้ (เว้นว่าง: ฝึกกับ CYRON)", "विरोधी (खाली: CYRON के साथ अभ्यास)",
    "相手（空欄: CYRONと練習）", "상대 (비우면: CYRON과 연습)", "对手（留空：与 CYRON 练习）"),
  equipar: L("Escolher as habilidades do personagem", "Pick your character's skills", "Elegir las habilidades del personaje",
    "Choisir les compétences du personnage", "Fähigkeiten der Figur auswählen", "Scegli le abilità del personaggio",
    "Kies de vaardigheden van je personage", "Выбрать умения персонажа", "Обрати вміння персонажа",
    "Wybierz umiejętności postaci", "Karakterin yeteneklerini seç", "Pilih kemampuan karakter",
    "Chọn kỹ năng cho nhân vật", "เลือกสกิลของตัวละคร", "किरदार की क्षमताएं चुनें", "キャラクターのスキルを選ぶ",
    "캐릭터 스킬 선택", "选择角色的技能"),
  "equipar personagem": QUAL_PERSONAGEM,
  codex: L("Seu álbum de curiosidades do Duelo", "Your Duel trivia album", "Tu álbum de curiosidades del Duelo",
    "Ton album d'anecdotes du Duel", "Dein Duell-Album mit Fakten", "Il tuo album di curiosità del Duello",
    "Je Duel-album met weetjes", "Твой альбом фактов о Дуэли", "Твій альбом цікавинок Дуелі",
    "Twój album ciekawostek z Pojedynku", "Düello merak albümün", "Album fakta Duel milikmu",
    "Album điều thú vị của Đấu tay đôi", "อัลบั้มเกร็ดความรู้จากการดวลของคุณ", "आपका द्वंद्व रोचक तथ्यों का एल्बम",
    "決闘の豆知識アルバム", "결투 상식 앨범", "你的对决趣闻图鉴"),
  "codex personagem": L("Ver as páginas de um personagem", "See a character's pages", "Ver las páginas de un personaje",
    "Voir les pages d'un personnage", "Die Seiten einer Figur ansehen", "Vedi le pagine di un personaggio",
    "Bekijk de pagina's van een personage", "Страницы персонажа", "Сторінки персонажа", "Zobacz strony postaci",
    "Bir karakterin sayfalarını gör", "Lihat halaman sebuah karakter", "Xem các trang của một nhân vật",
    "ดูหน้าของตัวละคร", "किसी किरदार के पन्ने देखें", "キャラクターのページを見る", "캐릭터 페이지 보기", "查看角色的页面"),

  sorteio: L("Criar um sorteio com botão", "Start a giveaway with a button", "Crear un sorteo con botón",
    "Lancer un tirage au sort avec un bouton", "Ein Gewinnspiel mit Button starten", "Crea un'estrazione con un pulsante",
    "Een winactie met knop starten", "Создать розыгрыш с кнопкой", "Створити розіграш із кнопкою",
    "Utwórz losowanie z przyciskiem", "Butonlu bir çekiliş başlat", "Buat undian dengan tombol",
    "Tạo bốc thăm trúng thưởng bằng nút", "สร้างการจับรางวัลด้วยปุ่ม", "बटन के साथ गिवअवे शुरू करें",
    "ボタン付きのプレゼント抽選を作成", "버튼으로 경품 추첨 만들기", "用按钮发起抽奖"),
  "sorteio premio": L("O prêmio", "The prize", "El premio", "Le prix", "Der Preis", "Il premio", "De prijs", "Приз", "Приз",
    "Nagroda", "Ödül", "Hadiahnya", "Giải thưởng", "ของรางวัล", "इनाम", "賞品", "상품", "奖品"),
  "sorteio duracao": L("Quanto tempo: 30m · 2h · 1d · 7d", "How long: 30m · 2h · 1d · 7d", "Cuánto dura: 30m · 2h · 1d · 7d",
    "Durée : 30m · 2h · 1d · 7d", "Dauer: 30m · 2h · 1d · 7d", "Durata: 30m · 2h · 1d · 7d", "Duur: 30m · 2h · 1d · 7d",
    "Длительность: 30m · 2h · 1d · 7d", "Тривалість: 30m · 2h · 1d · 7d", "Czas trwania: 30m · 2h · 1d · 7d",
    "Süre: 30m · 2h · 1d · 7d", "Durasi: 30m · 2h · 1d · 7d", "Thời lượng: 30m · 2h · 1d · 7d",
    "ระยะเวลา: 30m · 2h · 1d · 7d", "अवधि: 30m · 2h · 1d · 7d", "期間: 30m · 2h · 1d · 7d", "기간: 30m · 2h · 1d · 7d",
    "时长：30m · 2h · 1d · 7d"),
  "sorteio ganhadores": L("Quantos ganham (padrão 1)", "Number of winners (default 1)", "Cuántos ganan (por defecto 1)",
    "Nombre de gagnants (1 par défaut)", "Anzahl der Gewinner (Standard 1)", "Numero di vincitori (predefinito 1)",
    "Aantal winnaars (standaard 1)", "Сколько победителей (по умолчанию 1)", "Скільки переможців (типово 1)",
    "Liczba zwycięzców (domyślnie 1)", "Kazanan sayısı (varsayılan 1)", "Jumlah pemenang (bawaan 1)",
    "Số người thắng (mặc định 1)", "จำนวนผู้ชนะ (ค่าเริ่มต้น 1)", "कितने जीतेंगे (डिफ़ॉल्ट 1)", "当選者数（初期値 1）",
    "당첨자 수 (기본 1)", "中奖人数（默认 1）"),

  abraco: L("Dar um abraço", "Give someone a hug", "Dar un abrazo", "Faire un câlin", "Jemanden umarmen", "Dai un abbraccio",
    "Iemand een knuffel geven", "Обнять кого-нибудь", "Обійняти когось", "Przytul kogoś", "Birine sarıl",
    "Peluk seseorang", "Ôm một ai đó", "กอดใครสักคน", "किसी को झप्पी दें", "ハグする", "포옹하기", "给个拥抱"),
  "abraco membro": EM_QUEM,
  beijo: L("Dar um beijo", "Give someone a kiss", "Dar un beso", "Faire un bisou", "Jemandem einen Kuss geben",
    "Dai un bacio", "Iemand een kus geven", "Поцеловать кого-нибудь", "Поцілувати когось", "Pocałuj kogoś",
    "Birine öpücük ver", "Cium seseorang", "Hôn một ai đó", "จูบใครสักคน", "किसी को चुंबन दें", "キスする", "뽀뽀하기",
    "亲一下"),
  "beijo membro": EM_QUEM,
  tapa: L("Dar um tapa", "Slap someone", "Dar una bofetada", "Donner une gifle", "Jemandem eine Ohrfeige geben",
    "Dai uno schiaffo", "Iemand een klap geven", "Дать пощёчину", "Дати ляпаса", "Daj komuś plaskacza", "Birine tokat at",
    "Tampar seseorang", "Tát một ai đó", "ตบใครสักคน", "किसी को थप्पड़ मारें", "ビンタする", "따귀 때리기", "扇一巴掌"),
  "tapa membro": EM_QUEM,
  cafune: L("Fazer cafuné", "Give someone a headpat", "Hacer una caricia en la cabeza", "Caresser la tête de quelqu'un",
    "Jemandem den Kopf streicheln", "Accarezza la testa a qualcuno", "Iemand over het hoofd aaien", "Погладить по голове",
    "Погладити по голові", "Pogłaszcz kogoś po głowie", "Birinin başını okşa", "Elus kepala seseorang",
    "Xoa đầu một ai đó", "ลูบหัวใครสักคน", "किसी का सिर सहलाएं", "なでなでする", "쓰담쓰담하기", "摸摸头"),
  "cafune membro": EM_QUEM,

  perfil: L("Seu cartão: nível, XP e posição", "Your card: level, XP and rank", "Tu tarjeta: nivel, XP y posición",
    "Ta carte : niveau, XP et classement", "Deine Karte: Level, XP und Rang", "La tua scheda: livello, XP e posizione",
    "Je kaart: level, XP en positie", "Твоя карточка: уровень, XP и место", "Твоя картка: рівень, XP і місце",
    "Twoja karta: poziom, XP i pozycja", "Kartın: seviye, XP ve sıralama", "Kartumu: level, XP, dan peringkat",
    "Thẻ của bạn: cấp, XP và hạng", "การ์ดของคุณ: เลเวล, XP และอันดับ", "आपका कार्ड: लेवल, XP और रैंक",
    "あなたのカード: レベル、XP、順位", "내 카드: 레벨, XP, 순위", "你的卡片：等级、XP 和排名"),
  "perfil membro": L("Ver o de outra pessoa", "See someone else's", "Ver el de otra persona", "Voir celui de quelqu'un d'autre",
    "Das einer anderen Person ansehen", "Vedi quello di un'altra persona", "Dat van iemand anders bekijken",
    "Посмотреть чужую", "Переглянути чужу", "Zobacz kartę innej osoby", "Başkasınınkini gör", "Lihat milik orang lain",
    "Xem của người khác", "ดูของคนอื่น", "किसी और का देखें", "他の人のを見る", "다른 사람 것 보기", "查看别人的"),
  top: L("Quem mais participa no servidor", "Most active members of the server", "Quienes más participan en el servidor",
    "Les membres les plus actifs du serveur", "Die aktivsten Mitglieder des Servers", "I membri più attivi del server",
    "De actiefste leden van de server", "Самые активные участники сервера", "Найактивніші учасники сервера",
    "Najaktywniejsi członkowie serwera", "Sunucunun en aktif üyeleri", "Anggota paling aktif di server",
    "Thành viên tích cực nhất của máy chủ", "สมาชิกที่แอคทีฟที่สุดในเซิร์ฟเวอร์", "सर्वर के सबसे सक्रिय सदस्य",
    "サーバーで最も活発なメンバー", "서버에서 가장 활발한 멤버", "服务器最活跃的成员"),
  "top periodo": L("Desde sempre ou só esta semana", "All time or just this week", "Desde siempre o solo esta semana",
    "Depuis toujours ou juste cette semaine", "Insgesamt oder nur diese Woche", "Da sempre o solo questa settimana",
    "Altijd of alleen deze week", "За всё время или только эта неделя", "За весь час чи лише цей тиждень",
    "Od zawsze czy tylko ten tydzień", "Tüm zamanlar ya da sadece bu hafta", "Sepanjang waktu atau minggu ini saja",
    "Mọi lúc hay chỉ tuần này", "ตลอดกาลหรือเฉพาะสัปดาห์นี้", "अब तक का या सिर्फ़ इस हफ़्ते का", "累計か今週のみか",
    "전체 기간 또는 이번 주만", "全部时间或仅本周"),

  niveis: L("Ligar os níveis (XP) e dar cargos por nível", "Turn on levels (XP) and give roles per level",
    "Activar niveles (XP) y dar roles por nivel", "Activer les niveaux (XP) et donner des rôles par niveau",
    "Level (XP) einschalten und Rollen pro Level vergeben", "Attiva i livelli (XP) e assegna ruoli per livello",
    "Levels (XP) aanzetten en rollen per level geven", "Включить уровни (XP) и выдавать роли за уровень",
    "Увімкнути рівні (XP) і видавати ролі за рівень", "Włącz poziomy (XP) i nadawaj role za poziom",
    "Seviyeleri (XP) aç ve seviyeye göre rol ver", "Aktifkan level (XP) dan beri role per level",
    "Bật cấp độ (XP) và trao vai trò theo cấp", "เปิดระบบเลเวล (XP) และให้ยศตามเลเวล",
    "लेवल (XP) चालू करें और हर लेवल पर रोल दें", "レベル（XP）を有効にし、レベルごとにロールを付与",
    "레벨(XP)을 켜고 레벨별 역할 지급", "开启等级（XP）并按等级发放身份组"),
  "niveis ligar": L("Ligar ou desligar", "Turn on or off", "Activar o desactivar", "Activer ou désactiver",
    "Ein- oder ausschalten", "Attiva o disattiva", "Aan- of uitzetten", "Включить или выключить", "Увімкнути або вимкнути",
    "Włącz lub wyłącz", "Aç veya kapat", "Aktifkan atau matikan", "Bật hoặc tắt", "เปิดหรือปิด", "चालू या बंद करें",
    "オン/オフ", "켜기 또는 끄기", "开启或关闭"),
  "niveis canal": L("Onde anunciar quem subiu", "Where to announce level-ups", "Dónde anunciar quién subió",
    "Où annoncer les montées de niveau", "Wo Level-Aufstiege angekündigt werden", "Dove annunciare chi sale di livello",
    "Waar level-ups worden aangekondigd", "Где объявлять о новых уровнях", "Де оголошувати про нові рівні",
    "Gdzie ogłaszać awanse", "Seviye atlayanların duyurulacağı yer", "Tempat mengumumkan yang naik level",
    "Nơi thông báo người lên cấp", "ประกาศคนเลเวลอัปที่ไหน", "लेवल बढ़ने की घोषणा कहां हो", "レベルアップを告知する場所",
    "레벨업을 알릴 채널", "在哪里宣布升级"),
  "niveis nivel": L("Nível do cargo", "Level for the role", "Nivel del rol", "Niveau du rôle", "Level für die Rolle",
    "Livello del ruolo", "Level voor de rol", "Уровень для роли", "Рівень для ролі", "Poziom dla roli", "Rol için seviye",
    "Level untuk role", "Cấp cho vai trò", "เลเวลของยศ", "रोल का लेवल", "ロールのレベル", "역할의 레벨", "身份组对应的等级"),
  "niveis cargo": L("Cargo desse nível (vazio tira)", "Role for that level (empty removes)", "Rol de ese nivel (vacío lo quita)",
    "Rôle de ce niveau (vide = retirer)", "Rolle für dieses Level (leer entfernt)", "Ruolo per quel livello (vuoto lo rimuove)",
    "Rol voor dat level (leeg verwijdert)", "Роль для уровня (пусто — убрать)", "Роль для рівня (порожньо — прибрати)",
    "Rola dla poziomu (puste usuwa)", "O seviyenin rolü (boş bırakılırsa kaldırır)", "Role untuk level itu (kosong = hapus)",
    "Vai trò của cấp đó (để trống để gỡ)", "ยศของเลเวลนั้น (เว้นว่าง = ลบ)", "उस लेवल का रोल (खाली = हटाएं)",
    "そのレベルのロール（空欄で削除）", "해당 레벨 역할 (비우면 삭제)", "该等级的身份组（留空则移除）"),
  "niveis sem-xp": L("Sala (ou categoria) sem XP; de novo tira", "Channel (or category) with no XP; again removes",
    "Canal (o categoría) sin XP; otra vez lo quita", "Salon (ou catégorie) sans XP ; à nouveau = retirer",
    "Kanal (oder Kategorie) ohne XP; erneut entfernt", "Canale (o categoria) senza XP; di nuovo lo rimuove",
    "Kanaal (of categorie) zonder XP; opnieuw verwijdert", "Канал (или категория) без XP; повторно — убрать",
    "Канал (або категорія) без XP; повторно — прибрати", "Kanał (lub kategoria) bez XP; ponownie usuwa",
    "XP verilmeyen kanal (veya kategori); tekrar seçilirse kaldırır", "Channel (atau kategori) tanpa XP; ulangi = hapus",
    "Kênh (hoặc danh mục) không có XP; chọn lại để gỡ", "ห้อง (หรือหมวด) ที่ไม่ได้ XP; เลือกซ้ำ = ลบ",
    "बिना XP वाला चैनल (या श्रेणी); दोबारा = हटाएं", "XPなしのチャンネル（またはカテゴリ）、再指定で解除",
    "XP 없는 채널(또는 카테고리), 다시 지정하면 해제", "不计 XP 的频道（或分类）；再次选择则移除"),
  "niveis trocar": L("Cargo novo substitui o anterior", "New role replaces the old one", "El rol nuevo reemplaza al anterior",
    "Le nouveau rôle remplace l'ancien", "Neue Rolle ersetzt die alte", "Il nuovo ruolo sostituisce il precedente",
    "Nieuwe rol vervangt de oude", "Новая роль заменяет старую", "Нова роль замінює попередню",
    "Nowa rola zastępuje poprzednią", "Yeni rol eskisinin yerine geçer", "Role baru menggantikan yang lama",
    "Vai trò mới thay vai trò cũ", "ยศใหม่แทนที่ยศเดิม", "नया रोल पुराने की जगह लेगा", "新しいロールで前のロールを置き換える",
    "새 역할이 이전 역할을 대체", "新身份组替换旧身份组"),
  "niveis dobro-boost": L("XP em dobro para quem dá boost", "Double XP for boosters", "XP doble para quien da boost",
    "XP doublée pour les boosters", "Doppelte XP für Booster", "XP doppia per chi fa boost", "Dubbele XP voor boosters",
    "Двойной XP для бустеров", "Подвійний XP для бустерів", "Podwójne XP dla boosterów", "Boost yapanlara çift XP",
    "XP ganda untuk booster", "Gấp đôi XP cho người boost", "XP สองเท่าสำหรับผู้บูสต์", "बूस्ट करने वालों को दोगुना XP",
    "サーバーブースターはXP2倍", "부스터에게 XP 2배", "助力者双倍 XP"),
  "niveis dobro-cargo": L("XP em dobro para um cargo; de novo tira", "Double XP for a role; again removes",
    "XP doble para un rol; otra vez lo quita", "XP doublée pour un rôle ; à nouveau = retirer",
    "Doppelte XP für eine Rolle; erneut entfernt", "XP doppia per un ruolo; di nuovo lo rimuove",
    "Dubbele XP voor een rol; opnieuw verwijdert", "Двойной XP для роли; повторно — убрать",
    "Подвійний XP для ролі; повторно — прибрати", "Podwójne XP dla roli; ponownie usuwa",
    "Bir role çift XP; tekrar seçilirse kaldırır", "XP ganda untuk role; ulangi = hapus",
    "Gấp đôi XP cho một vai trò; chọn lại để gỡ", "XP สองเท่าสำหรับยศ; เลือกซ้ำ = ลบ",
    "किसी रोल को दोगुना XP; दोबारा = हटाएं", "特定ロールはXP2倍、再指定で解除", "특정 역할 XP 2배, 다시 지정하면 해제",
    "某身份组双倍 XP；再次选择则移除"),

  xp: L("Dar, tirar ou zerar XP de alguém", "Give, take or reset someone's XP", "Dar, quitar o reiniciar la XP de alguien",
    "Donner, retirer ou remettre à zéro l'XP de quelqu'un", "XP von jemandem geben, abziehen oder zurücksetzen",
    "Dai, togli o azzera l'XP di qualcuno", "XP van iemand geven, afnemen of resetten",
    "Выдать, снять или обнулить XP участника", "Видати, зняти або обнулити XP учасника",
    "Dodaj, odbierz lub wyzeruj czyjeś XP", "Birine XP ver, al veya sıfırla", "Beri, kurangi, atau reset XP seseorang",
    "Cộng, trừ hoặc đặt lại XP của ai đó", "เพิ่ม ลด หรือรีเซ็ต XP ของใครสักคน", "किसी का XP दें, घटाएं या रीसेट करें",
    "メンバーのXPを付与・削減・リセット", "멤버의 XP 지급, 차감 또는 초기화", "给予、扣除或重置某人的 XP"),
  "xp dar": L("Dar XP", "Give XP", "Dar XP", "Donner de l'XP", "XP geben", "Dai XP", "XP geven", "Выдать XP", "Видати XP",
    "Dodaj XP", "XP ver", "Beri XP", "Cộng XP", "เพิ่ม XP", "XP दें", "XPを付与", "XP 지급", "给予 XP"),
  "xp dar membro": QUEM,
  "xp dar quantidade": QUANTO,
  "xp tirar": L("Tirar XP", "Take XP", "Quitar XP", "Retirer de l'XP", "XP abziehen", "Togli XP", "XP afnemen", "Снять XP",
    "Зняти XP", "Odbierz XP", "XP al", "Kurangi XP", "Trừ XP", "ลด XP", "XP घटाएं", "XPを削減", "XP 차감", "扣除 XP"),
  "xp tirar membro": QUEM,
  "xp tirar quantidade": QUANTO,
  "xp zerar": L("Zerar a XP", "Reset XP", "Reiniciar la XP", "Remettre l'XP à zéro", "XP zurücksetzen", "Azzera l'XP",
    "XP resetten", "Обнулить XP", "Обнулити XP", "Wyzeruj XP", "XP'yi sıfırla", "Reset XP", "Đặt lại XP", "รีเซ็ต XP",
    "XP रीसेट करें", "XPをリセット", "XP 초기화", "重置 XP"),
  "xp zerar membro": QUEM,
};

/* O /evento, o /hora e o /boas-vindas já vinham traduzidos no index.js
   (TRADUCOES_DO_EVENTO e companhia), sem holandês e hindi: só essas duas
   entram aqui. O que já existe lá vale primeiro. */
Object.assign(DESCRICOES_DOS_COMANDOS, {
  "evento o-que": { nl: "Naam van het evenement. Bijv.: Berenval", hi: "इवेंट का नाम। जैसे: Bear Trap" },
  "evento quando": { nl: "Optioneel: 3h · 20:30 · 04/10 11:30. Leeg: kies in het paneel",
    hi: "वैकल्पिक: 3h · 20:30 · 04/10 11:30. खाली: पैनल में चुनें" },
  "evento fuso": { nl: "Tijdzone (standaard: UTC, de klok van het spel)", hi: "टाइम ज़ोन (डिफ़ॉल्ट: UTC, गेम की घड़ी)" },
  "evento duracao": { nl: "Hoe lang het duurt. Bijv.: 30m · 1h43m27s · 5d", hi: "कितनी देर चलेगा। जैसे: 30m · 1h43m27s · 5d" },
  "evento repetir": { nl: "Herhalen nadat het sluit. Bijv.: 24h · 47h · 7d", hi: "खत्म होने के बाद दोहराएं। जैसे: 24h · 47h · 7d" },
  "evento lembrete": { nl: "Herinnering per DM voor wie zich aanmeldde, vóór de start",
    hi: "शुरू होने से पहले, साइन अप करने वालों को DM में रिमाइंडर" },
  "evento gif": { nl: "GIF of afbeelding van het evenement (bestand)", hi: "इवेंट का GIF या चित्र (फ़ाइल)" },
  "evento gif-link": { nl: "Of de link van de GIF (https://...)", hi: "या GIF का लिंक (https://...)" },
  "evento cargo": { nl: "Rol om op het moment te taggen, naast wie zich aanmeldde",
    hi: "समय पर टैग करने वाला रोल, साइन अप करने वालों के अलावा" },
  "evento detalhes": { nl: "Wat er verder nog gezegd moet worden", hi: "और क्या बताना है" },
  "boas-vindas": { nl: "Welkomstkaart met foto voor nieuwkomers, in alle talen", hi: "नए सदस्यों के लिए फ़ोटो वाला स्वागत कार्ड, सभी भाषाओं में" },
  "boas-vindas canal": { nl: "Waar de kaart verschijnt", hi: "कार्ड कहां दिखेगा" },
  "boas-vindas desligar": { nl: "Welkomstkaart met afbeelding uitzetten", hi: "फ़ोटो वाला स्वागत कार्ड बंद करें" },
  hora: { nl: "De huidige tijd in elk land van de server", hi: "सर्वर के हर देश का मौजूदा समय" },
  "hora quando": { nl: "Optioneel: een tijd omrekenen. Bijv.: 17:00 · 04/10 20:30", hi: "वैकल्पिक: समय बदलें। जैसे: 17:00 · 04/10 20:30" },
});

/* As escolhas das listas, pelo valor. */
export const ESCOLHAS_DOS_COMANDOS = {
  "top periodo": {
    sempre: L("🏆 Desde sempre", "🏆 All time", "🏆 Desde siempre", "🏆 Depuis toujours", "🏆 Insgesamt", "🏆 Da sempre",
      "🏆 Altijd", "🏆 За всё время", "🏆 За весь час", "🏆 Od zawsze", "🏆 Tüm zamanlar", "🏆 Sepanjang waktu",
      "🏆 Mọi lúc", "🏆 ตลอดกาล", "🏆 अब तक", "🏆 累計", "🏆 전체", "🏆 全部"),
    semana: L("📅 Esta semana", "📅 This week", "📅 Esta semana", "📅 Cette semaine", "📅 Diese Woche", "📅 Questa settimana",
      "📅 Deze week", "📅 Эта неделя", "📅 Цей тиждень", "📅 Ten tydzień", "📅 Bu hafta", "📅 Minggu ini", "📅 Tuần này",
      "📅 สัปดาห์นี้", "📅 इस हफ़्ते", "📅 今週", "📅 이번 주", "📅 本周"),
  },
};

/* Os menus de botão direito (Apps → ...): ninguém digita, então o nome
   também vai traduzido. */
export const NOMES_DOS_MENUS = {
  "Criar evento": L("Criar evento", "Create event", "Crear evento", "Créer un événement", "Ereignis erstellen", "Crea evento",
    "Evenement maken", "Создать событие", "Створити подію", "Utwórz wydarzenie", "Etkinlik oluştur", "Buat acara",
    "Tạo sự kiện", "สร้างกิจกรรม", "इवेंट बनाएं", "イベントを作成", "이벤트 만들기", "创建活动"),
};

/* Comando publicado fora desta lista (o /mylanguage), que só ganha as
   descrições. */
export const DESCRICOES_DE_FORA = {
  mylanguage: L("Escolher o seu idioma", "Choose your language", "Elegir tu idioma", "Choisir ta langue",
    "Deine Sprache wählen", "Scegli la tua lingua", "Kies je taal", "Выбрать свой язык", "Обрати свою мову",
    "Wybierz swój język", "Dilini seç", "Pilih bahasamu", "Chọn ngôn ngữ của bạn", "เลือกภาษาของคุณ", "अपनी भाषा चुनें",
    "言語を選ぶ", "언어 선택", "选择你的语言"),
};
