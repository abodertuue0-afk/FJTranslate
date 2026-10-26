// عبارات جاهزة مترجمة مسبقاً (تعمل فوراً دون نموذج ودون إنترنت).

export const PHRASE_CATEGORIES = [
  { id: 'greetings', title: 'تحيات', icon: '🌸' },
  { id: 'study', title: 'الجامعة والدراسة', icon: '📚' },
  { id: 'law', title: 'قانون ومحاكم', icon: '⚖️' },
  { id: 'daily', title: 'يومية وطوارئ', icon: '🎀' },
];

export const PHRASES = [
  // تحيات
  { cat: 'greetings', en: 'Hello!', ar: 'مرحباً!' },
  { cat: 'greetings', en: 'Good morning.', ar: 'صباح الخير.' },
  { cat: 'greetings', en: 'Good evening.', ar: 'مساء الخير.' },
  { cat: 'greetings', en: 'How are you?', ar: 'كيف حالك؟' },
  { cat: 'greetings', en: "I'm fine, thank you.", ar: 'أنا بخير، شكراً لك.' },
  { cat: 'greetings', en: 'Nice to meet you.', ar: 'تشرفت بمعرفتك.' },
  { cat: 'greetings', en: 'Thank you very much.', ar: 'شكراً جزيلاً.' },
  { cat: 'greetings', en: "You're welcome.", ar: 'عفواً.' },
  { cat: 'greetings', en: 'Excuse me.', ar: 'المعذرة.' },
  { cat: 'greetings', en: "I'm sorry.", ar: 'أنا آسفة.' },
  { cat: 'greetings', en: 'See you tomorrow.', ar: 'أراك غداً.' },
  { cat: 'greetings', en: 'Have a nice day!', ar: 'أتمنى لك يوماً سعيداً!' },

  // الجامعة والدراسة
  { cat: 'study', en: 'Could you repeat that, please?', ar: 'هل يمكنك إعادة ذلك من فضلك؟' },
  { cat: 'study', en: 'Could you speak more slowly?', ar: 'هل يمكنك التحدث ببطء أكثر؟' },
  { cat: 'study', en: 'What does this word mean?', ar: 'ما معنى هذه الكلمة؟' },
  { cat: 'study', en: "I didn't understand the question.", ar: 'لم أفهم السؤال.' },
  { cat: 'study', en: 'When is the exam?', ar: 'متى الامتحان؟' },
  { cat: 'study', en: 'Where is the library?', ar: 'أين المكتبة؟' },
  { cat: 'study', en: 'I have a lecture at nine.', ar: 'عندي محاضرة في الساعة التاسعة.' },
  { cat: 'study', en: 'Is attendance mandatory?', ar: 'هل الحضور إلزامي؟' },
  { cat: 'study', en: 'Can I borrow your notes?', ar: 'هل يمكنني استعارة ملاحظاتك؟' },
  { cat: 'study', en: 'I need to submit my research paper.', ar: 'يجب أن أسلّم بحثي.' },
  { cat: 'study', en: 'What chapters are included in the exam?', ar: 'ما الفصول المشمولة في الامتحان؟' },
  { cat: 'study', en: 'May I ask a question?', ar: 'هل يمكنني أن أطرح سؤالاً؟' },

  // قانون ومحاكم
  { cat: 'law', en: 'I would like to consult a lawyer.', ar: 'أودّ استشارة محامٍ.' },
  { cat: 'law', en: 'What are my rights?', ar: 'ما هي حقوقي؟' },
  { cat: 'law', en: 'I need a copy of the contract.', ar: 'أحتاج نسخة من العقد.' },
  { cat: 'law', en: 'Please sign here.', ar: 'يُرجى التوقيع هنا.' },
  { cat: 'law', en: 'This clause is unclear.', ar: 'هذا البند غير واضح.' },
  { cat: 'law', en: 'The hearing has been postponed.', ar: 'تم تأجيل الجلسة.' },
  { cat: 'law', en: 'The court ruled in favor of the plaintiff.', ar: 'حكمت المحكمة لصالح المدّعي.' },
  { cat: 'law', en: 'The decision can be appealed.', ar: 'يمكن الطعن في القرار.' },
  { cat: 'law', en: 'According to Article 5 of the law.', ar: 'وفقاً للمادة الخامسة من القانون.' },
  { cat: 'law', en: 'Everyone is equal before the law.', ar: 'الجميع متساوون أمام القانون.' },
  { cat: 'law', en: 'The accused is presumed innocent until proven guilty.', ar: 'المتهم بريء حتى تثبت إدانته.' },
  { cat: 'law', en: 'The contract is null and void.', ar: 'العقد باطل.' },

  // يومية وطوارئ
  { cat: 'daily', en: 'How much is this?', ar: 'بكم هذا؟' },
  { cat: 'daily', en: 'What time is it?', ar: 'كم الساعة؟' },
  { cat: 'daily', en: 'Where is the nearest pharmacy?', ar: 'أين أقرب صيدلية؟' },
  { cat: 'daily', en: 'I need help.', ar: 'أحتاج مساعدة.' },
  { cat: 'daily', en: 'Call an ambulance!', ar: 'اتصلوا بالإسعاف!' },
  { cat: 'daily', en: "I don't speak English well.", ar: 'لا أتكلم الإنجليزية جيداً.' },
  { cat: 'daily', en: 'Can you help me, please?', ar: 'هل يمكنك مساعدتي من فضلك؟' },
  { cat: 'daily', en: 'I am lost.', ar: 'لقد ضللت الطريق.' },
];
