/**
 * The illustrated guide on the Yardım page, one topic per menu entry.
 * Pictures live in public/help; the studio's own screens are retaken with `npm run help:screenshots`.
 */
export interface HelpStep {
  /** One instruction; **bold** marks the words on the screen (button names). */
  text: string;
  image?: string;
  alt?: string;
}
export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  steps: HelpStep[];
  /** Reference parts after the steps: what each thing on the screen does, what to do when… */
  sections?: { title: string; items: string[] }[];
  tips?: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'baslarken',
    title: 'Başlarken',
    summary: 'Soru Stüdyosu, soru görselinizi ve çözümünüzü sesli, işaretli bir çözüm videosuna dönüştürür. Her şey tarayıcıda, beş kolay adımda olur.',
    steps: [
      { text: 'Girişten sonra **Kontrol Paneli** açılır. Burada kaldığınız soruyu, soru sayılarınızı ve son çalıştığınız soruları görürsünüz.', image: 'panel', alt: 'Kontrol Paneli ve sol menü' },
      { text: 'Soldaki menüden sayfalar arasında geçersiniz: **Yeni soru**, **Hazırlık Araçları**, **Sorularım**, **Toplu Üretim**, **Konu Anlatımı**, **Ayarlar** ve bu **Yardım** sayfası.' },
      { text: 'Bir soru her zaman aynı beş adımdan geçer: **1 Soru** (görsel) → **2 Metin** (çözüm) → **3 Ses** → **4 İşaretler** → **5 İndir** (MP4 video).', image: 'adimlar', alt: 'Editörün üstündeki beş adım' },
      { text: 'Çalışmanız kendiliğinden kaydedilir. Sağ üstte **Kaydedildi** yazısını gördüğünüzde her şey hesabınızdadır; başka bir bilgisayardan girince kaldığınız yerden devam edersiniz.' },
    ],
    tips: [
      'Yazılar size küçük geliyorsa **Ayarlar → Yazı boyutu** bölümünden “Büyük” veya “Çok büyük” seçebilirsiniz.',
      'Tarayıcının geri tuşu stüdyo içinde bir önceki sayfaya döner; sayfayı yenilediğinizde aynı soru açık kalır.',
    ],
  },
  {
    id: 'hazirlik-araclari',
    title: 'Hazırlık araçları',
    summary: 'Stüdyoya gelmeden önce soru görselinizi ve çözüm metninizi komisyonumuzdan bir öğretmenin hazırladığı iki araçla hazırlayabilirsiniz.',
    steps: [
      { text: 'Sol menüden **Hazırlık Araçları**’nı açın. Her aracın **Aç** düğmesi aracı yeni bir sekmede açar; stüdyo kendi sekmesinde açık kalır.' },
      { text: '**Soru şablonu yerleştirici:** PowerPoint’teki sorularınızı Bakanlığın soru şablonuna yerleştirir, boyutlandırır ve uzun soruları ikiye böler. Kesim yeri uygun değilse elle hızlıca düzeltin, sonra soruları resim olarak toplu indirin (**Tümünü İndir (ZIP)**).', image: 'arac-sablon', alt: 'Soru şablonu yerleştirici ekranı' },
      { text: '**Çözüm senaryosu oluşturucu:** Soru görsellerini toplu yükleyin; araç her sorunun çözüm metnini hazırlar. Arapça sorular için de kullanılabilir. İlk açılışta kendi Google anahtarınızı girmeniz gerekir (**Önce API Anahtarını Girin**).', image: 'arac-senaryo', alt: 'Çözüm senaryosu oluşturucu ekranı' },
      { text: 'Stüdyoya dönün: indirdiğiniz resmi **Yeni soru** ile **1 Soru** adımına yükleyin, çözüm metnini **2 Metin** adımındaki kutuya yapıştırın.' },
    ],
    tips: ['Soru eklerken de araçlara ulaşabilirsiniz: **1 Soru** adımında görsel yokken şablon aracına, **2 Metin** adımında metin kutusu boşken çözüm senaryosu aracına giden bağlantı görünür.', 'Araçları komisyonumuzdan Ubeydullah Öz hazırladı.', 'Araçlar başka bir sitede çalışır; orada yaptıklarınız stüdyoya kendiliğinden gelmez. İndirdiğiniz resmi ve kopyaladığınız metni stüdyoya siz eklersiniz.'],
  },
  {
    id: 'yeni-soru',
    title: 'Yeni soru ekleme',
    summary: 'Yeni bir soru videosuna soru türünü seçip soru görselini yükleyerek başlarsınız.',
    steps: [
      { text: 'Sol menünün en üstündeki kırmızı **Yeni soru** düğmesine basın.', image: 'yeni-soru', alt: 'Yeni soru düğmesi' },
      { text: 'Açılan pencerede sorunun türünü seçin (örneğin **Deneme** veya **Çıkmış Soru**) ve **Projeyi Başlat**’a basın.', image: 'soru-tipi', alt: 'Soru türü seçme penceresi' },
      { text: 'Editör **1 Soru** adımında açılır. Soru görselini kutunun üzerine sürükleyin ya da kutuya tıklayıp bilgisayarınızdan seçin (PNG, JPG veya WebP).', image: 'gorsel-yukle', alt: 'Soru görseli yükleme alanı' },
      { text: 'Görsel yüklenince **Metne geç** düğmesiyle ikinci adıma geçin. Şıkların (A–E) yeri daha sonra, işaretler hazırlanırken görselden kendiliğinden bulunur.' },
    ],
    tips: [
      'Sorunun adını, koleksiyonunu (deneme adı) ve yılını sağdaki **Proje bilgileri** bölümünden değiştirebilirsiniz.',
      'Görseli yanlış yüklediyseniz **1 Soru** adımında **Görseli Değiştir** ile yenisini seçebilirsiniz. Ses daha önce hazırlandıysa yeniden seslendirmeniz gerekmez: ses ve çözüm metni korunur, işaretler yeni görsele göre kendiliğinden yeniden hazırlanır. Eski görselde elle yaptığınız işaret düzeltmeleri silinir; gerekirse yeni görselde tekrar yapın.',
    ],
  },
  {
    id: 'cozum-metni',
    title: 'Çözüm metnini yazma',
    summary: 'Çözümü, öğrenciye anlatır gibi yazarsınız. Seslendirme ve işaretler bu metinden hazırlanır.',
    steps: [
      { text: 'Önce **Doğru cevap** kutusundan doğru şıkkı seçin. Ardından çözümü büyük metin kutusuna yazın veya yapıştırın.', image: 'cozum-metni', alt: 'Çözüm metni ve doğru cevap' },
      { text: 'Şıkları anlatırken şık harfini yazın: “A şıkkı … olmaz”, “B ve E şıklarını eliyoruz”, “Doğru cevap D şıkkı” gibi. Sistem bu cümlelerden hangi şıkkın ne zaman çarpı, hangisinin tik alacağını anlar.' },
      { text: 'Metnin altındaki kontrol kutusunda her şıkkın ne olacağını görürsünüz (✗ elenir / ✓ doğru cevap). Bir şık eksikse cümlenizi o şıkkı adıyla anarak düzeltin.' },
      { text: 'Metne mutlaka kısa bir **Türkçe cümleyle** başlayın (örneğin “Önce paragrafı okuyalım.”). Ses hangi dille başlarsa o dilin aksanını sürdürür: metin Arapça başlarsa Türkçeyi de Arap aksanıyla okur. Arapça ifadeleri de Türkçe bir cümlenin içinde verin: “A seçeneğinde şu ifade var: …” gibi.' },
      { text: 'Arapça ifadeleri **harekeli** yazın; seslendirme böylece doğru okur ve ifadeler görselde bulunup altı çizilir. Bitince **Sese geç**’e basın.' },
    ],
    tips: ['Metin en fazla 10.000 karakter olabilir; sayaç kutunun altında görünür. Çok uzun metinler (yaklaşık 450 kelimeden uzun) paragraf sonlarından 2–3 bölüme ayrılıp seslendirilir ve tek ses dosyasında birleştirilir; her bölüm bir ses hakkı kullanır. Daha kısa metinler tek seferde okunur.'],
  },
  {
    id: 'seslendirme',
    title: 'Ses adımı: tam rehber',
    summary: 'Çözüm metniniz Türkçe ve Arapça olarak seslendirilir. Sesi dinler, yanlış okunan yer varsa yalnız o cümleyi düzeltir ve onaylarsınız. Bütün sesi yeniden üretmek son çaredir.',
    steps: [
      { text: '**3 Ses** adımına geçin. Henüz ses yoksa sağda iki seçenek vardır: **Seslendirme Oluştur** (stüdyo okur) ve **MP3 Yükle** (kendi kaydınız). **Seslendirme Oluştur**’a basın. Ses birkaç saniye ile bir iki dakika arasında hazırlanır; bu sırada sayfayı kapatmayın. Hazırlanırken sağda hangi aşamada olduğu (soru kaydediliyor, ses üretiliyor, birleştiriliyor, kelime zamanları alınıyor) ve ne kadar süredir beklediğiniz görünür.', image: 'ses-olustur', alt: 'Seslendirme Oluştur ve MP3 Yükle düğmeleri' },
      { text: 'Ses hazır olunca sorunun altında **Ses şeridi** açılır. Üstte sesin dalgası, altında çözümünüzün her cümlesi bir kutucuk olarak durur. Kutucuk, o cümlenin seste okunduğu yerdedir. Arapça cümleler bej, Türkçe cümleler mavi renktedir.' },
      { text: '**Oynat**’a basıp sesi baştan sona dinleyin. O an okunan cümle hem şeritte çerçeveyle hem de sorunun altında yazı olarak görünür. Dalganın üstünde bir yere tıklarsanız ses oradan devam eder.', image: 'ses-onay', alt: 'Ses şeridinde Oynat ve sağda Bu Sesi Kullan' },
      { text: 'Yanlış okunan bir yer duyduğunuz anda **Burada hata var**’a basın. Ses durur ve az önce okunan cümle seçilir (koyu kırmızı olur). Seçili cümle şeridin altında yazılı görünür; **Dinle** ile yalnız o cümleyi dinleyebilirsiniz. Hatayı duymadan da bir cümlenin kutucuğuna tıklayarak seçebilirsiniz.', image: 'sesi-duzelt', alt: 'Burada hata var, seçili cümle ve Yeniden seslendir' },
      { text: 'Hata birkaç cümleye yayılıyorsa ilk ve son cümlenin kutucuğuna tıklayın; aradaki bütün cümleler seçilir. Seçili bir cümleye tekrar tıklarsanız o cümle seçimden çıkar. **Seçimi kaldır** ya da **Esc** seçimi tamamen bırakır.' },
      { text: '**Yeniden seslendir**’e basın. Yalnız seçtiğiniz yer yeniden okunur ve eskisinin yerine konur; kesim cümle aralarındaki duraklamalardan yapılır. Sesin geri kalanı ve işaretleriniz olduğu gibi kalır. Bir iki cümlede onay sorulmaz; dört beş cümleden uzun seçimlerde önce onayınız istenir. Her düzeltme 1 ses hakkı kullanır.' },
      { text: 'Yeni hali hazır olunca kendiliğinden çalar. Doğru okunduysa **Oldu**, okunmadıysa **Olmadı, geri al** deyin; **Tekrar dinle** ile bir kez daha dinleyebilirsiniz. Geri alınca önceki ses aynen geri gelir. Yine olmadıysa aynı cümleyi bir kez daha yeniden seslendirebilirsiniz.' },
      { text: 'Ses baştan sona doğruysa sağdaki **Bu Sesi Kullan**’a basın. Ses **Onaylandı** olur. **İşaretlere geç** ile dördüncü adıma geçin. Onaylanmamış bir sesle video hazırlanamaz.' },
    ],
    sections: [
      {
        title: 'Sağ paneldekiler ne işe yarar?',
        items: [
          '**Karakter sayacı ve şık kontrolü** (örneğin “686 / 10.000 karakter”): Metninizin uzunluğunu ve her şık için ne olacağını gösterir: ✗ elenir (hangi sözle), ✓ doğru cevap. Bir şık için “işaret yok” yazıyorsa o şık metinde harfiyle anılmıyordur; **2 Metin** adımında cümlenizi düzeltin.',
          '**Telaffuzu kısa bir örnekle dene**: Nasıl okunacağından emin olmadığınız bir kelimeyi ya da cümleyi (en fazla 350 karakter) yazıp **Örnek ses üret** deyin. Ana sesiniz değişmez, ancak bu deneme de 1 ses hakkı kullanır.',
          '**Eğitmen Sesi** kutusu: Sesin durumunu gösterir: **Onay Bekliyor** ya da **Onaylandı**.',
          '**Ses Dosyasını İndir**: Sesi MP3 olarak bilgisayarınıza indirir.',
          'Sağdaki **Yeniden seslendir**: **Bütün** sesi baştan üretir. Eski ses silinir; işaretleri de yeniden hazırlamanız gerekir. Uzun metinlerde birden çok hak harcar. Yalnızca metni baştan değiştirdiyseniz kullanın; bir iki cümle için şeritteki düzeltmeyi kullanın.',
          '**Bu Sesi Kullan**: Sesi onaylar.',
          'En alttaki kapasite satırı: Bugün ortak kapasiteden ne kadar kullanıldığını ve kendi anahtarınız varsa onun durumunu gösterir.',
        ],
      },
      {
        title: 'Ses şeridindeki her şey',
        items: [
          '**Oynat / Durdur** ve yanındaki süre (geçen / toplam).',
          '**Burada hata var**: Sesi durdurur ve az önce okunan cümleyi seçer.',
          'Cümle kutucuğuna **bir kez** tıklamak cümleyi seçer, **çift** tıklamak yalnız o cümleyi çalar.',
          '**Daha fazla** düğmesinin içinde: yakınlaştırma (**−**, **+**, **Tümü**); **Cümle listesi** (cümleleri alt alta, saatleriyle gösterir, uzun metinlerde seçmek daha kolaydır); **Zamanla seç** (“2:00” ve “2:10” yazıp **Seç** deyince o aralıktaki cümleler seçilir).',
          'Turuncu ünlem işareti: “Okunmamış görünüyor”. O yer şeridin altında yazılı olarak da listelenir; **Bu yeri ekle** ile yalnız o yer okunup doğru yerine eklenir. Arapça kelimeler bazen farklı yazıya döküldüğü için bu uyarı yanlış çıkabilir: önce dinleyin, doğru okunmuşsa dokunmayın.',
          '**Bölümler** satırı (çok uzun metinlerde): Metin 2–3 bölümde seslendirildiyse her bölümü ayrı dinleyebilir, mikrofon düğmesiyle yalnız o bölümü yeniden seslendirebilirsiniz.',
          '**Son düzeltmeyi geri al**: Yalnızca en son yaptığınız düzeltmeyi geri alır.',
        ],
      },
      {
        title: 'Kendi sesinizi (MP3) kullanmak',
        items: [
          '**MP3 Yükle** ile kaydınızı seçin. Stüdyo kaydı dinleyip her kelimenin zamanını çıkarır; bu biraz sürebilir.',
          'Okuduğunuz metin çözüm metniyle aynı olmalıdır; işaretler kelimelere göre yerleştirilir. Metinden farklı okursanız işaretler kayar.',
          'Yüklenen seste Ses şeridi yoktur; sağdaki oynatıcıyla dinlersiniz. Kaydı değiştirmek için **MP3 Değiştir**, kaldırmak için **Sil**.',
          'Kendi kaydınızın bir kısmı stüdyoda yeniden seslendirilemez; kaydı düzeltip yeniden yükleyin.',
        ],
      },
      {
        title: 'Ses hakları ve hatalar',
        items: [
          'Her seslendirme, her cümle düzeltmesi ve her örnek ses 1 hak kullanır; çok uzun metinler bölüm başına 1 hak kullanır.',
          'Günlük ücretsiz haklar Türkiye saatiyle 10:00’da (yaz saatinde 11:00) yenilenir. “Bugünkü ücretsiz ses hakkı bitti” yazarsa yenilenmeyi bekleyin ya da kendi Google anahtarınızı ekleyin (bkz. **Google anahtarı alma**).',
          'Sesler önce **en üst düzey modelle** üretilir. Bu modelin günlük hakkı bitince stüdyo bugün kaç ses kullandığınızı yazar ve sorar: **Sonraki modele geç** derseniz ses sonraki modelle üretilir; **Kapat** derseniz hiçbir hak harcanmaz.',
          '“Google’dan cevap gelmedi” yazarsa Google o an yoğundur; birkaç dakika sonra tekrar deneyin.',
          '“Google bu metni seslendirmedi” yazarsa Google o metni kabul etmiyordur (bazı ayet, hadis ya da hastalık anlatan pasajlarda olabiliyor). Aynı metinle yeniden denemek sonuç vermez; stüdyo aynı gün aynı metni tekrar göndermez, böylece hakkınız boşa gitmez. Metinde küçük bir değişiklik yapıp yeniden deneyin ya da sesi kendiniz kaydedip yükleyin.',
          'Bir iki cümle hatalıysa bütün sesi baştan üretmeyin: Ses şeridinde o cümleyi seçip **Sesi düzelt**’e basın. Hem sesin iyi kısımları bozulmaz hem de en üst düzey modelin hakkı daha geç biter.',
          'Bir hata çıkarsa üst üste denemeyin: her deneme bir hak harcar. İki denemede olmuyorsa sol menüdeki **Sorun bildir** ile bize yazın.',
        ],
      },
      {
        title: 'Sesin ilk seferde doğru çıkması için metni nasıl yazmalı?',
        items: [
          'Arapça ifadeleri **harekeli** yazın. Son hareke ve tenvin de yazdığınız gibi okunur (fetha yazılan yer ötre okunmaz); şıklardaki tek kelimeler gibi tek başına duran kelimelerde de.',
          'Seste yanlış okunan bir harekeyi düzeltmek için metne aynı harekeyi birkaç kez yazmayın; sesi düzeltmez. Kelimeyi bir kez doğru harekeleyin ya da telaffuz sözlüğüne ekleyin.',
          'Türkçe ile Arapçayı aynı cümlenin içinde sık sık karıştırmayın. Arapça alıntıyı tam bir cümle olarak verin, açıklamasını ayrı bir Türkçe cümleyle yapın; iki dil de böyle daha doğru okunur.',
          'Uzun bir Arapça paragrafı tek parça hâlinde, arasına Türkçe koymadan yazın.',
          'Kısaltma ve sembol yerine okunacak hâlini yazın (örneğin “vb.” yerine “ve benzeri”).',
        ],
      },
      {
        title: 'Telaffuz sözlüğü',
        items: [
          'Ses bir kelimeyi her seferinde yanlış okuyorsa (bir kısaltma, bir özel isim, bir Arapça kelime) **Ayarlar → Telaffuz sözlüğü**’ne ekleyin: solda çözümde yazdığınız hâli, sağda nasıl okunması gerektiğini yazın (örneğin “MEB” → “Meb”).',
          'Ekranda, altyazıda ve videoda yazı olduğu gibi kalır; yalnız ses sözlükteki gibi okur. Kelime tek başına geçtiği yerlerde değiştirilir, başka bir kelimenin içinde değiştirilmez. Büyük-küçük harf fark etmez; harekesiz yazdığınız Arapça kelime, metinde harekeli de olsa bulunur. Harekeli yazdığınız kelime önce aynı harekeli hâliyle aranır; bulunmazsa farklı son harekeli, eksik ya da fazladan harekeli hâli de bulunur.',
          'Sözlük bütün hocalar için ortaktır: birinin eklediği kelime herkesin seslendirmesinde geçerlidir. Eklediğiniz kelimeyi silebilirsiniz.',
          'Sözlük yeni seslendirmelerde ve cümle düzeltmelerinde kullanılır; hazır sesler kendiliğinden değişmez. Hatalı cümleyi Ses şeridinde seçip yeniden seslendirin.',
        ],
      },
    ],
    tips: [
      'Klavyeyle: **Boşluk** oynatır/durdurur, **← →** önceki/sonraki cümleyi seçer (**Shift** ile seçime ekler), **Enter** seçili yeri dinletir, **Esc** seçimi kaldırır.',
      'Ekranınız küçükse sağ üstteki **Tam ekranda düzenle** ile yalnız soru ve şerit kalır; **Paneli gizle** sağ paneli kapatır.',
    ],
  },
  {
    id: 'isaretler',
    title: 'İşaretler adımı: tam rehber',
    summary: 'Çarpı, tik, çerçeve, altı çizgi ve vurgular sesle aynı anda çıkar. Stüdyo bunları metninizden ve seslendirmeden kendisi yerleştirir; siz videoyu izler, yalnız yanlış olanı düzeltirsiniz.',
    steps: [
      { text: '**4 İşaretler** adımında ilk kez **İşaretleri otomatik hazırla**’ya basın. Stüdyo soru görselini okur (şıkları ve Arapça ifadeleri bulur), metninizden hangi şıkkın ne zaman eleneceğini çıkarır ve her işareti seste söylendiği ana yerleştirir. Pencerede bu üç aşama sırayla işaretlenir. Birkaç saniye sürer.' },
      { text: 'Ekranda üstte videonun önizlemesi, altında ayarlar satırı ve **Zaman şeridi** vardır. Önizlemede ▶ ile videoyu izleyin; 1× … 2× düğmeleriyle daha hızlı izleyebilirsiniz.', image: 'isaretler', alt: 'Önizleme ve işaret araçları' },
      { text: 'Yanlış bir şey görürseniz **Burada hata var**’a basın: video durur ve az önce çıkan işaretin kutusu görselde seçilir.' },
      { text: 'Video durunca görsel düzenlenebilir olur. Bir kutuya ya da işarete tıklayınca yanında küçük bir çubuk açılır: işaretleri ve saatleri, şık kutularında **Şık** harfleri, kopyala, yapıştır ve sil düğmeleri buradadır.', image: 'isaret-secili', alt: 'Seçili kutu ve çubuğu' },
      { text: 'Bir işaretin zamanını **Zaman şeridi**nden düzeltin. Her işaret bir kutucuktur: sürükleyince işaret daha erken ya da geç çıkar, kenarından çekince ne kadar kalacağı değişir.', image: 'zaman-seridi', alt: 'Zaman şeridi' },
      { text: 'Bitince **İndirmeye geç**’e basın. Değişiklikler kendiliğinden kaydedilir.' },
    ],
    sections: [
      {
        title: 'İşaret türleri',
        items: [
          '**✗ Çarpı** (kırmızı): Elenen şık. Bir kez çıkınca videonun sonuna kadar kalır.',
          '**✓ Doğru işareti** (yeşil): Doğru cevap; doğru şık yeşil çerçeve içinde kalır. Öncüle (I, II, III) ya da başka bir yere konan tik yalnızca kısaca parlar.',
          '**◎ Çerçeve**: Bir şıktan ya da ifadeden bahsedilirken onu çerçeveye alır, sonra kalkar.',
          '**◯ Daire** (kırmızı): Bir kelimenin ya da şıkkın etrafına elle çizilmiş gibi bir halka çizer; süresi bitince kalkar.',
          '**▁ Altı çizgi**: İfade okunurken altı kelime kelime çizilir. Çözüm uzun bir Arapça şıkkı (beş kelimeden uzun) okurken o şıkkın satırlarının altı da okundukça çizilir.',
          '**▮ Vurgu**: İfadenin üstünden fosforlu kalem gibi geçer.',
          'Doğru cevap söylendiyse videonun sonunda kısa bir **Doğru cevap** kartı çıkar (ayarlar satırındaki **Kapanış kartı** ile kapatılabilir).',
        ],
      },
      {
        title: 'Stüdyo işaretleri neye göre koyar? (Metni böyle yazın)',
        items: [
          'Şıkkı harfiyle anın: “A şıkkı … olmaz”, “C seçeneği yanlıştır”, “B ve E şıklarını eliyoruz”, “Doğru cevap D şıkkı”. Harfiyle anılmayan şıkka işaret konamaz.',
          'Bir şıktan bahsedilince çerçeve, elendiği söylenince çarpı, doğru denince tik, tam o söz söylendiği anda çıkar.',
          'Çözümdeki Arapça ifadeler görselde aranır; bulunanların altı, ifade okunurken çizilir.',
          'Uzun bir Arapça paragrafı (10 kelimeden uzun) baştan sona okursanız stüdyo paragrafı görselde bulur ve her satırın altını o satır okunurken çizer. Paragrafı arasına Türkçe kelime koymadan yazın.',
          'Açıklamada paragraftan bir ifadeyi tekrar okursanız (“yani اِسْتِخْلَاصَ الْخُيُوطِ …”), ifadenin paragraftaki yerinin altı yeniden çizilir.',
        ],
      },
      {
        title: 'Görsel üzerindeki araçlar (soldaki dikey çubuk)',
        items: [
          '**↖ Seç ve taşı**: Bir kutuya ya da işarete tıklayıp seçer. Elle koyduğunuz işareti (çarpı, tik, çizgi, daire) doğrudan kendisinden tutup sürükleyin; çarpı ve tiki köşelerinden, çizgiyi iki ucundan, daireyi kenarlarından büyütüp küçültün. Taşırken yazı satırlarına ve diğer işaretlere hizalanır.',
          '**✗ ✓**: Önce önizlemeyi işaretin çıkacağı anda durdurun. Aracı seçip görselde istediğiniz noktaya tıklayın: işaret tam oraya konur. Var olan bir kutuya (örneğin bir şıkka) tıklarsanız o kutu işaretlenir.',
          '**◎ ◯ ▮**: Aracı seçip istediğiniz yere sürükleyerek alan çizin. Daire tam çizdiğiniz alanın etrafına çizilir. Var olan bir kutuya tıklarsanız işaret o kutuya konur.',
          'Önizleme durduğunda işaretler tamamlanmış hâliyle görünür; eklediğiniz işaret hemen görülür. Oynatınca her biri sesteki anında çizilerek gelir.',
          '**▁ Alt çizgi**: Aracı seçin, çizginin başlayacağı yere basın ve basılı tutup sağa ya da sola sürükleyip bırakın. Çizginin kalınlığı ve rengi sabittir, yalnız boyu değişir. Yazının hemen altına bırakırsanız çizgi kendiliğinden o satırın altına oturur. Videoda çizgi, sizin sürüklediğiniz yönde akar (Arapça için sağdan sola sürükleyin). Çizilmiş bir çizginin yönünü, kutusuna tıklayınca çıkan küçük çubuktaki **⇄ Sağdan sola / Soldan sağa** düğmesiyle çevirirsiniz.',
          'Çizgi, önizlemenin durduğu anda zaman şeridine iner; ne kadar süreceğini şeritte kenarından çekerek ya da **Şimdi** düğmesiyle dinleyerek ayarlarsınız. Çizgiyi sonradan uzatıp kısaltmak için seçin ve iki ucundaki tutamaçları çekin.',
          '**▁** aracı çizdikten sonra açık kalır: birkaç satırın altını arka arkaya çizebilirsiniz. Her çizgi önizlemenin durduğu anda başlar ve hemen görünür; zamanlarını şeritten ayarlarsınız. Bitince **Esc**’ye basın.',
          'Stüdyonun kendisinin bulduğu bir ifadede çizgiyi seçince çizginin kendisini fareyle tutup yukarı aşağı sürükleyerek yalnız o çizginin yüksekliğini ayarlayabilirsiniz.',
          '**➜ Ok**: Aracı seçin, okun kuyruğundan basın ve ucunun gideceği yere sürükleyip bırakın. Videoda ok kuyruğundan ucuna doğru uzayarak gelir. Araç açık kalır, birkaç ok çizebilirsiniz; bitince **Esc**. Okun yönünü küçük çubuktaki ⇄ düğmesiyle çevirirsiniz.',
          '**T Yazı**: Aracı seçip yazının çıkacağı yere tıklayın (ya da sürükleyerek alanını çizin). Küçük çubuktaki kutuya yazınızı girip Enter’a basın; Türkçe de Arapça da yazabilirsiniz. Yazı kutusunu köşelerinden büyütünce yazı da büyür.',
          'Görselin üstündeki **Geri al** son değişikliği geri alır (**Ctrl+Z**), **Yinele** geri aldığınızı geri getirir (**Ctrl+Y**).',
        ],
      },
      {
        title: 'Seçince çıkan küçük çubuk',
        items: [
          'İşaretler: her işaret simgesi ve saatiyle yazar. Raptiye (**Buraya al**) işareti önizlemenin durduğu ana taşır; ✕ işareti siler.',
          '**Şık** harfleri: Kutunun hangi şık olduğunu söyler. Bir harfe basınca kutu o şık olur; o şıkkın çarpısı ya da tiki sese göre kendiliğinden gelir. (Şık kutularında ve elle çizilen düz kutularda görünür.)',
                    'Kopyala / Yapıştır: kutuyu ya da işareti çoğaltır. Kopya biraz yanda çıkar ve işaretleri önizlemenin durduğu andan başlar; sürükleyip yerine koyun.',
          '**Renkler**: Alt çizgi, daire, ok ve yazının rengini değiştirir (kırmızı, turuncu, yeşil, mavi, mor, siyah).',
          '**Otomatiğe döndür**: Stüdyonun bulduğu bir kutuyu (bir şık, bir ifade) taşıdıysanız ya da boyunu değiştirdiyseniz, kutuyu bulunduğu yere ve boya geri getirir.',
          'Çöp kutusu: kutuyu ya da işareti siler (**Delete** tuşu da siler).',
        ],
      },
      {
        title: 'Zaman şeridi',
        items: [
          'Üstte sesin dalgası, altında işaret kutucukları vardır. Kırmızı dikey çizgi önizlemenin şu anki yeridir; dalgaya tıklayınca oraya gidilir.',
          'Renkler: turuncu altı çizgi, mor çerçeve, kırmızı daire ve çarpı, yeşil tik.',
          'Bir kutucuğa tıklayınca altta ayarları çıkar: **Şimdi başlasın / Şimdi bitsin**, **Erken / Geç** (0,1 saniye), **Kısa / Uzun** (yarım saniye) ve **Sil**.',
          '**Şimdi ile dinleyerek zamanlama** (en kolay yol): İşaretin kutucuğuna tıklayın, **Boşluk** ile sesi oynatın. İşaret çıkması gereken anda **Şimdi başlasın**’a (ya da **Enter**’a) basın; altı çizgi, çerçeve ve dairede bitmesi gereken anda bir kez daha basın (**Şimdi bitsin**). Çarpı ve tik yalnız başlar, sona kadar kalır.',
          'Çarpı ve tik sona kadar kaldığı için yalnız başlangıçları taşınır.',
          'Yakınlaştırma düğmeleri (**+**, **−**, **Tümü**) ince ayar içindir.',
        ],
      },
      {
        title: 'Önizlemenin altındaki ayarlar satırı',
        items: [
          '**Altyazıları göster**: Videoda okunan cümlenin yazısını açar ya da kapatır.',
          '**Altyazı konumu**: Altyazıyı yukarı ya da aşağı taşır.',
          '**Soru boyutu** (**−**, **Tam boy**, **+**): Altyazı bir şıkkı kapatıyorsa soruyu küçültün; küçülen soru altyazının üstünde durur.',
          '**Altı çizgi ↑ Yukarı / ↓ Aşağı**: Videodaki bütün altı çizgileri birlikte kaydırır. Kaydırınca yanında çıkan **sıfırla** ile normal yerine dönersiniz.',
          '**Kapanış kartı**: Videonun sonundaki “Doğru cevap” kartını açar ya da kapatır.',
        ],
      },
      {
        title: 'Sık karşılaşılan durumlar',
        items: [
          '**Bir şık bulunamadı** (“Eksik şık: C”): Sağdaki **Yayına hazır** listesinde **C şıkkını görselde göster**’e basıp kutusunu çizin; ya da o şıkkı gösteren kutuya tıklayıp **Hangi şık?** satırından C’yi seçin. Çarpısı ya da tiki sese göre kendiliğinden gelir.',
          '**İki şık tek kutuda birleşmiş** (örneğin B ile C): Kutuyu tutamaçlarından küçültüp yalnız B’yi içine alacak hâle getirin. **Yayına hazır** listesi C’yi eksik gösterir; **C şıkkını görselde göster**’e basıp C’nin kutusunu çizin. C’nin işaretleri kendiliğinden gelir.',
          '**Bir kelimenin altı çizilmemiş**: Önizlemeyi o kelimenin okunduğu yerde durdurun, ▁ aracıyla kelimenin altına sağdan sola sürükleyin. Süresini **Şimdi** ile dinleyerek ayarlayın.',
          '**Altı çizgiler kelimelerin fazla altında ya da üstünde**: Ayarlar satırındaki **↑ Yukarı / ↓ Aşağı**.',
          '**İşaret erken ya da geç çıkıyor**: Kutucuğu seçip dinlerken **Şimdi başlasın**’a basın ya da şeritte sürükleyin. İnce ayar için **Erken / Geç**.',
          '**Altyazı bir şıkkı kapatıyor**: **Soru boyutu −** ile soruyu küçültün ya da **Altyazı konumu**nu değiştirin.',
          '**Her şey karıştı**: Sağdaki **İşaretleri yeniden hazırla** işaretleri baştan kurar. Elle yaptığınız düzeltmeler silineceği için önce onay ister.',
          'Sağ panelde görselin nasıl okunduğu ve varsa paragrafın kaç satırının bulunduğu yazar. Paragraf görselde bulunamazsa sebebi de orada yazar.',
          'Görsel Google’ın okuyucusuyla bir kez okununca okuma soruyla saklanır: **İşaretleri yeniden hazırla** günlük okuma hakkınızdan düşmez. Yalnız görseli değiştirince yeni görsel bir daha okunur.',
          'Google’ın okuyucusu kullanılamadığında görsel stüdyonun kendi okuyucusuyla okunur. Bu okuyucu görseli büyütüp siyah-beyaz yaptığı için soluk filigranlar okumayı bozmaz; Arapçayı iki modelle okur (hocaların soru görselleriyle eğitilmiş kendi modelimiz ve hazır model) ve daha emin okuyanı kullanır. Yine de bir şık ya da kelime kaçarsa kutusunu elle çizin.',
        ],
      },
    ],
    tips: [
      'Klavyeyle: **Boşluk** oynatır/durdurur, **Ctrl+Z** geri alır, **Ctrl+Y** yineler, **Ctrl+C / Ctrl+V** seçili kutuyu kopyalar/yapıştırır, **Delete** seçili kutuyu siler, **Esc** seçimi bırakır. Şeritte **Enter** seçili işareti o anda başlatır / bitirir, **← →** önceki/sonraki işarete gider, **Shift + ← →** seçili işareti 0,1 saniye kaydırır.',
      'Ekranınız küçükse sağ üstteki **Tam ekranda düzenle** düğmesine basın: yalnız soru ve zaman şeridi kalır, ikisi de kaydırmadan ekrana sığar. **Esc** ile geri dönersiniz. **Paneli gizle** sağdaki paneli kapatıp şeride yer açar.',
    ],
  },
  {
    id: 'video-indir',
    title: 'Videoyu indirme',
    summary: 'Son adımda video, bilgisayarınızda MP4 dosyası olarak hazırlanır ve iner.',
    steps: [
      { text: '**5 İndir** adımında **Yayına hazır** listesini okuyun: bulunan şıklar, doğru cevap ve işaretlerin sese bağlılığı burada kontrol edilir. Kırmızı bir madde varsa yanındaki düğmeyle düzeltin.', image: 'video-indir', alt: 'Video indirme adımı' },
      { text: '**MP4 İndir (1080p)** düğmesine basın. Düğmede “MP4 Hazırlanıyor… %40” gibi ilerleme görünür; bitene kadar bu sekmeyi kapatmayın.' },
      { text: 'Video, tarayıcınızın **İndirilenler** klasörüne sorunun adıyla kaydedilir.' },
      { text: '**Video bilgileri** bölümünü açınca sorunun başlığı, koleksiyonu, soru numarası, konusu, doğru cevabı ve süresi görünür; **Kopyala** ile yükleme formuna yapıştırabilirsiniz.' },
      { text: 'İndirilen soru **Tamamlandı** olarak işaretlenir ve kontrol listelerinden çıkar; Sorularım’da yanında “✓ Tamamlandı” yazar. Değişiklik yapmak isterseniz **Düzenlemeye geri aç**’a basın, bitince yeniden indirin. Videoyu daha önce indirdiyseniz **tamamlandı olarak işaretleyin** bağlantısını kullanın.' },
    ],
    tips: ['Video bilgisayarınızın tarayıcısında hazırlanır. Tarayıcınız video hazırlayamıyorsa (bazı Safari ve iPad sürümleri) stüdyo daha açılırken en üstte sarı bir uyarı gösterir; soruyu yine hazırlayabilirsiniz ama videoyu bilgisayarda güncel Chrome ya da Edge ile indirin.', 'Altyazıları, soru boyutunu ve sondaki “Doğru cevap” kapanış kartını önizlemenin altındaki seçeneklerden açıp kapatabilirsiniz.', 'Bütün videoların sesi indirilirken aynı seviyeye getirilir: kısık kaydedilmiş bir MP3 de, yüksek bir ses de videoda aynı yükseklikte duyulur. Önizlemede ses kaydedildiği gibi çalar.'],
  },
  {
    id: 'soru-listesi',
    title: 'Sorularım ve koleksiyonlar',
    summary: 'Tüm sorularınız **Sorularım** sayfasındadır. Arayabilir, süzebilir, sıralayabilir ve birden çok soruya aynı anda işlem yapabilirsiniz.',
    steps: [
      { text: 'Üstteki kutuya soru adı, yıl veya Arapça bir kelime yazarak arayın. Altındaki kutularla koleksiyona, yıla, kategoriye veya aşamaya göre süzün; son kutudan sıralamayı seçin.', image: 'soru-listesi', alt: 'Soru listesi, arama ve sıralama' },
      { text: 'Bir soruya devam etmek için **Devam et**’e basın. Kopya kâğıt simgesi soruyu çoğaltır (metin ve ayarlar kopyalanır, ses yeniden hazırlanır).' },
      { text: 'Birden çok soru seçmek için satırların solundaki kutucukları işaretleyin (hepsi için **Tümünü seç**). Altta açılan koyu çubuktan **Koleksiyona taşı**, **Yedeğini indir (ZIP)** veya **Çöp kutusuna taşı** seçin.', image: 'toplu-secim', alt: 'Seçili sorular için işlem çubuğu' },
      { text: '**Koleksiyona taşı** penceresinde bir deneme adı yazın ya da önceki adlardan birine tıklayın ve **Taşı**’ya basın.', image: 'koleksiyon', alt: 'Koleksiyona taşıma penceresi' },
      { text: '**Konu:** Her soruya bir konu yazabilirsiniz (örneğin “İsm-i mevsul”). Soru açıkken üstteki soru bilgilerinde **Konu** kutusuna yazın ya da listeden seçin; birden çok soru için soruları seçip alttaki çubuktan **Konu ver**’e basın. Sorularım’daki **Tüm konular** kutusuyla bir konunun sorularını süzersiniz. Yönetici panelinde hangi konudan kaç soru olduğu ve sorusu olmayan konular görünür.' },
      { text: '**Bilgi listesi (Excel):** Soruları seçip alttaki çubuktan **Bilgi listesi (Excel)**’e basın: her sorunun başlığı, koleksiyonu, soru numarası, konusu, doğru cevabı ve süresi Excel’de açılan bir liste olarak iner. Tek bir sorunun bilgileri **5 İndir** adımındaki **Video bilgileri**’ndedir; **Kopyala** ile alırsınız.' },
      { text: '**Bir denemeyi baştan sona izlemek için:** Koleksiyon kutusundan denemeyi seçin, sıralamayı **Soru numarasına göre** yapın, **Tümünü seç**’i işaretleyip alttaki çubuktan **Arka arkaya izle**’ye basın. Videolar indirileceği gibi sırayla oynar; biri bitince sıradaki kendiliğinden başlar. Hatalı gördüğünüz soruda **Düzeltilecek olarak işaretle**’ye basın. İzleme bitince işaretlediğiniz sorular listelenir; **Aç** ile düzenlemeye geçersiniz. Sesi ya da işaretleri hazır olmayan sorular atlanır.' },
    ],
    tips: ['Seçtiğiniz sıralama bu bilgisayarda hatırlanır.'],
  },
  {
    id: 'cop-ve-yedek',
    title: 'Çöp kutusu ve yedekleme',
    summary: 'Silinen sorular 30 gün çöp kutusunda bekler. Ayrıca tüm sorularınızı tek bir ZIP dosyasıyla bilgisayarınıza yedekleyebilirsiniz.',
    steps: [
      { text: 'Bir soruyu sildiğinizde **Çöp kutusu** sekmesine gider. Oradan **Geri al** ile listenize döndürebilirsiniz. 30 gün dolunca soru kendiliğinden kalıcı olarak silinir; her satırda kaç gün kaldığı yazar.', image: 'cop-kutusu', alt: 'Çöp kutusu' },
      { text: 'Yedek almak için **Ayarlar → Yedekleme** bölümünde **Tüm sorularımı yedekle**’ye basın. İnen ZIP dosyasında sorularınız, soru görselleri ve sesler bulunur; dosyayı güvenli bir yerde (USB bellek, Google Drive gibi) saklayın.', image: 'yedekleme', alt: 'Yedekleme bölümü' },
      { text: 'Geri yüklemek için aynı bölümde **Yedekten geri yükle**’ye basıp ZIP dosyasını seçin. Hesabınızda zaten olan sorular silinmez ya da değiştirilmez; yedekteki hâli ayrı bir soru olarak eklenir.' },
    ],
    tips: ['Yalnız bazı soruları yedeklemek için **Sorularım** sayfasında soruları seçip **Yedeğini indir (ZIP)** düğmesini kullanın.'],
  },
  {
    id: 'toplu-uretim',
    title: 'Toplu üretim',
    summary: 'Bir denemenin bütün sorularını tek seferde hazırlayabilirsiniz: görseller, tek bir çözüm metni ve isteğe bağlı MP3’ler soru numarasına göre eşleşir.',
    steps: [
      { text: 'Sol menüden **Toplu Üretim**’i açın. **Soru görselleri** kutusuna tüm görselleri bırakın; dosya adlarında soru numarası olmalı (soru_3.png, S3.jpg, 3.png gibi).', image: 'toplu-uretim', alt: 'Toplu üretim sayfası' },
      { text: 'Sağdaki **Çözüm metinleri** kutusuna bütün çözümleri yazın. Her soru kendi satırında “Soru 3” gibi bir başlıkla başlamalıdır. İsterseniz MP3 dosyalarını da ekleyin; adındaki numara o soruya eşleşir.' },
      { text: 'Koleksiyon adını ve seçenekleri belirleyip **Başlat**’a basın. Tabloda her sorunun durumu görünür. İşlem bitene kadar sekmeyi açık tutun.' },
      { text: 'Videolar bitince tek bir ZIP dosyası olarak iner. Tekrar indirmek için **Hepsini ZIP olarak indir**, tek bir video için satırdaki **MP4** düğmesini kullanın.' },
    ],
    tips: ['Yarım kalan sorular olursa **Yarım kalanları tamamla** düğmesiyle kaldıkları yerden devam edebilirsiniz.'],
  },
  {
    id: 'konu-anlatimi',
    title: 'Konu anlatımı videosu',
    summary: 'Hazır bir sunumu sesli konu anlatımı videosuna çevirirsiniz: slaytlar sırayla ekranda durur, her slaytın sesi altından anlatır. Anlatılan madde slaytta fosforlu kalemle boyanır, anlatımı bitince yanına tik atılır.',
    steps: [
      { text: 'Sunumunuzu PowerPoint’te **Dosya → Farklı Kaydet → PDF** ile PDF olarak kaydedin. Slaytlar PDF’te nasıl görünüyorsa videoda da öyle görünür.' },
      { text: 'Sol menüden **Konu Anlatımı**’nı açın ve **Yeni konu anlatımı**’na basın. PDF’i açılan alana bırakın ya da seçin. Her sayfa bir slayt olur, sırası korunur; konu adı PDF’in adından gelir, üstten değiştirebilirsiniz.' },
      { text: 'Soldaki listeden bir slayt seçin ve **Bu slaytta ne anlatacaksınız?** kutusuna o slaytın metnini yazın. Metin kendiliğinden kaydedilir.' },
      { text: '**Sesi oluştur**’a basın ve sesi dinleyin. Beğenmezseniz yalnız o slaytı **Yeniden seslendir**in; diğer slaytların sesi değişmez. Kendi kaydınızı kullanmak isterseniz **MP3 yükle**’ye basın.' },
      { text: 'Bütün metinleri yazdıysanız alttaki **Eksik sesleri oluştur** düğmesi sesi olmayan slaytları sırayla seslendirir. Her slayt bir ses hakkı kullanır; bir slaytta sorun çıkarsa durur.' },
      { text: 'Her slaytın sesi hazır olunca **Baştan izle** ile videoyu indirmeden önce baştan sona izleyin. Alttaki numaralarla istediğiniz slayta atlarsınız.' },
      { text: '**Videoyu indir (MP4)**’e basın. Slaytlar sesiyle birlikte tek bir 1080p video olarak iner; bitene kadar sekmeyi kapatmayın.' },
    ],
    sections: [
      {
        title: 'Slaytları düzenleme',
        items: [
          'Listede her slaytın durumu yazar: **Metin yok**, **Ses yok**, **Metin değişti** (metni sesten sonra değiştirdiniz, yeniden seslendirin) ya da **Ses hazır**.',
          '**Yukarı / Aşağı** slaytın yerini değiştirir, **Sil** slaytı çıkarır, **Slayt ekle** sona yeni slaytlar ekler.',
          'Bir slaytta yazım hatası gördüyseniz PowerPoint’te düzeltip sunumu yeniden PDF olarak kaydedin. O slaytı seçip **Resmi değiştir** ile yeni PDF’i seçin: aynı sayfa numarası alınır, metin ve ses olduğu gibi kalır.',
          'Slaytları resim olarak (PNG, JPG) da yükleyebilirsiniz; dosya adındaki numaraya göre sıralanır (Slayt2, Slayt10’dan önce gelir).',
        ],
      },
      {
        title: 'Slayttaki işaretler',
        items: [
          'Bir cümle okunurken slaytta o cümlenin anlattığı madde, satır ya da tablo satırının altı, ses ilerledikçe çizilir (Türkçe soldan sağa, Arapça sağdan sola); Arapça örnekte yanındaki Türkçe karşılığının altı da çizilir. Anlatımı biten maddenin yanına yeşil tik gelir. Çizim, soru videolarındakiyle aynıdır.',
          'Stüdyo hangi cümlenin hangi maddeyi anlattığını slayttaki yazılarla metninizi karşılaştırarak bulur. “Birincisi, ikincisi…” dediğinizde sıradaki madde işaretlenir. Emin olamadığı cümlede işaret koymaz; aynı paragraftaki önceki işaret sürer.',
          'Slaytın yanındaki **Slayttaki işaretler** listesinde her cümlenin neyi işaretleyeceği yazar. Cümlenin üzerine gelince o yer slaytta gösterilir. Yanlışsa listeden doğru maddeyi seçin ya da **İşaret yok** deyin; ok simgesi otomatik seçime döndürür.',
          'İşaretin ne zaman geleceğini stüdyo sesin kendisinden bulur: her cümlenin işareti, ses o cümleye geçtiği anda başlar.',
          'Yer ya da zaman tutmuyorsa **İşaretleri düzenle**’ye basın. Soru editöründeki işaret ekranının aynısı açılır: aynı araçlar (çarpı, tik, çerçeve, daire, alt çizgi, vurgu, ok, yazı), renkler, **Geri al / Yinele**, **Altı çizgi ↑ Yukarı / ↓ Aşağı** ve zaman şeridi. Kullanımı için **İşaretler adımı: tam rehber** konusuna bakın.',
          'Her slaytın sesi ayrı olduğu için işaretler de slayt slayt düzenlenir; üstteki **Önceki slayt / Sonraki slayt** ile slaytlar arasında geçersiniz. Video indirilirken slaytlar sesleriyle birlikte sırayla birleştirilir.',
          'Alt çizginin yönünü siz seçersiniz: çizerken sağa ya da sola sürükleyin, çizilmiş bir çizgide kutusuna tıklayıp **⇄** düğmesine basın.',
          'Düzenleyicide yaptığınız her değişiklik kaydedilir ve videoda bu işaretler kullanılır. **Otomatik işaretlere dön** elle yaptıklarınızı siler. Slaytı yeniden seslendirirseniz ya da yeni ses yüklerseniz elle yaptığınız değişiklikler silinir, çünkü zamanları eski sese göreydi.',
          'Otomatik işaretler yalnız PDF’ten eklenen slaytlarda çıkar. Resim olarak eklediğiniz slaytta **İşaretleri düzenle** ile yeri kendiniz çizebilir ya da **Resmi değiştir** ile sunumun PDF’ini seçebilirsiniz. Kapak slaytına otomatik işaret konmaz.',
          'Hiç işaret istemiyorsanız alttaki **Slaytlarda işaretler** kutusundaki işareti kaldırın; slaytlar düz kalır.',
        ],
      },
    ],
    tips: [
      'PowerPoint dosyası (.pptx) doğrudan okunamaz; önce PDF olarak kaydedin.',
      'Bir slaytın metni Arapça başlıyorsa kısa bir Türkçe cümleyle başlatın, yoksa ses Türkçeyi de Arap aksanıyla okur.',
      'Slaytlar arasında kısa bir sessizlik bırakılır ve sıradaki slayt yumuşakça gelir.',
    ],
  },
  {
    id: 'google-anahtari',
    title: 'Google anahtarı alma',
    summary: 'Stüdyonun ortak günlük ses hakkı dolduğunda kendi ücretsiz Google AI Studio anahtarınızla çalışmaya devam edebilirsiniz. Anahtar almak iki dakika sürer ve ücretsizdir.',
    steps: [
      { text: 'Tarayıcıda **aistudio.google.com** adresini açın ve kendi Google hesabınızla giriş yapın. Sol alttaki anahtar simgesine (**Get API key**) tıklayın.', image: 'aistudio-1-anahtar-simgesi', alt: 'AI Studio: sol alttaki Get API key simgesi' },
      { text: 'Açılan **API Keys** sayfasında sağ üstteki **Create API key** düğmesine basın.', image: 'aistudio-2-anahtar-olustur', alt: 'AI Studio: Create API key düğmesi' },
      { text: '**Create a new key** penceresinde anahtara bir ad verin (örneğin “Soru Stüdyosu”). **Choose an imported project** listesini açın ve **Create project** ile yeni bir proje oluşturun; sonra anahtarı oluşturma düğmesine basın.', image: 'aistudio-3-proje-sec', alt: 'AI Studio: anahtar adı ve proje seçimi' },
      { text: 'Anahtar listede görünür. Anahtarın ayrıntı penceresinde **Copy key** düğmesine basarak anahtarı kopyalayın.', image: 'aistudio-4-anahtari-kopyala', alt: 'AI Studio: Copy key düğmesi' },
      { text: 'Stüdyoda **Ayarlar → Google anahtarım** bölümüne gidin, anahtarı kutuya yapıştırın ve **Kaydet**’e basın. Anahtar Google’da doğrulanır ve bölümün başında **Bağlı** yazar.', image: 'anahtar-kaydet', alt: 'Stüdyo: Google anahtarım bölümü' },
    ],
    tips: [
      '**Set up billing** (faturalandırma) bağlantısına basmayın: anahtar ücretsiz kotayla çalışır, size hiçbir ücret yansımaz.',
      'Anahtarınızı kimseyle paylaşmayın, e-posta veya mesajla göndermeyin. Stüdyo anahtarı şifreli saklar ve bir daha göstermez.',
      'Ücretsiz günlük hak her gün Türkiye saatiyle 10:00–11:00 arasında yenilenir.',
    ],
  },
  {
    id: 'ayarlar',
    title: 'Ayarlar ve yazı boyutu',
    summary: 'Yazı boyutunu, adınızı, şifrenizi ve yeni sorulara ait varsayılanları **Ayarlar** sayfasından değiştirirsiniz.',
    steps: [
      { text: '**Yazı boyutu** bölümünde **Normal**, **Büyük** veya **Çok büyük**’ü seçin. Yazılar ve düğmeler hemen büyür; seçiminiz hesabınızla girdiğiniz her bilgisayarda kullanılır.', image: 'yazi-boyutu', alt: 'Yazı boyutu seçimi' },
      { text: '**Yeni soru varsayılanları** bölümünde kategori, koleksiyon adı, sınav yılı, altyazı ve kapanış kartını bir kez ayarlayın; her yeni soru bu değerlerle başlar.', image: 'varsayilanlar', alt: 'Yeni soru varsayılanları' },
      { text: '**Profilim** bölümünden görünen adınızı ve şifrenizi değiştirebilirsiniz.' },
    ],
  },
  {
    id: 'sorun-bildir',
    title: 'Mesajlar, sorun bildirme ve sık sorulanlar',
    summary: 'Bir şey beklediğiniz gibi çalışmazsa tek tıkla yöneticiye haber verebilirsiniz.',
    steps: [
      { text: 'Sol menüdeki ya da editörün sağ üstündeki **Sorun bildir**’e basın, ne olduğunu kısaca yazın ve gönderin. Hangi sayfada olduğunuz gibi teknik bilgiler kendiliğinden eklenir.', image: 'sorun-bildir', alt: 'Sorun bildir penceresi' },
      { text: 'Sol menüdeki **Mesajlar** yöneticiyle birebir yazışmanızdır: yöneticinin size gönderdiği mesajları orada okur, ona oradan yazarsınız. Yeni mesaj ya da bildiriminize yanıt gelince yanında sayı çıkar.' },
      { text: 'Gönderdiğiniz sorun bildirimleri de **Mesajlar**’ın altında, çözülüp çözülmediği ve yöneticinin yanıtıyla birlikte görünür.' },
      { text: 'Mesaj yazarken bir sözün başına ve sonuna iki yıldız (**) koyarsanız o söz kalın görünür; “- ” ile başlayan satırlar madde olur. Yöneticinin duyuruları da aynı biçimde görünür.' },
    ],
    tips: [
      '**Çalışmam kayboldu mu?** Hayır. Stüdyo her değişikliği birkaç saniye içinde kaydeder. İnternet kesilirse değişiklikler bu bilgisayarda saklanır ve bağlantı gelince gönderilir.',
      '**Silinen soru nerede?** Sorularım → Çöp kutusu sekmesinde, 30 gün boyunca.',
      '**Ses oluşturulmuyor.** Günlük ücretsiz hak dolmuş olabilir. Ertesi gün tekrar deneyin ya da kendi Google anahtarınızı ekleyin.',
      '**Video inmiyor.** İndirme bitene kadar sekmeyi açık tutun; tarayıcı birden çok dosya indirmek için izin isterse izin verin. “Ses dosyası indirilemedi” yazarsa internet bağlantınızı kontrol edip tekrar deneyin.',
    ],
  },
];

export const helpImage = (name: string) => `/help/${name}.webp`;
