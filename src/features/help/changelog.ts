/**
 * "Yenilikler": what changed for teachers, one entry per day (id YYYY-MM-DD, date "1 Ekim 2026"),
 * newest first. A new change goes into today's entry, under a group title; a new day gets a new
 * entry. Plain Turkish, one sentence per item; `help` links to a Yardım topic.
 */
export interface NewsItem { text: string; help?: string }
export interface NewsEntry { id: string; date: string; title: string; groups: { title: string; items: NewsItem[] }[] }

export const NEWS: NewsEntry[] = [
  {
    id: '2026-10-16',
    date: '16 Ekim 2026',
    title: 'Yan yana şıklarda doğru şık kutusu',
    groups: [
      {
        title: 'İşaretler',
        items: [
          { text: 'Şıklar yan yana dizildiğinde (A B / C D / E) sağdaki şıkların kutusu bazen yalnız harfi (B, D) içine alıyordu; çerçeve ve çarpı yazının yanında kalıyordu. Artık kutu şıkkın yazısını da kapsar.', help: 'isaretler' },
          { text: 'Tek kelimelik kısa şıkların yazısı görsel okunurken atlanırsa, stüdyo o şıkkın harfinin yanını ayrıca okur; şık kutusunu elle büyütmeniz çoğu zaman gerekmez.', help: 'isaretler' },
        ],
      },
    ],
  },
  {
    id: '2026-10-15',
    date: '15 Ekim 2026',
    title: 'Sunumdan sesli konu anlatımı videosu',
    groups: [
      {
        title: 'Konu Anlatımı',
        items: [
          { text: 'Sol menüde yeni **Konu Anlatımı** bölümü var. Sunumunuzu PDF olarak yükleyin, her slayta ne anlatacağınızı yazıp sesini oluşturun; slaytlar sesiyle birlikte tek bir video olarak iner.', help: 'konu-anlatimi' },
          { text: 'Her slaytın sesi ayrı üretilir: beğenmediğiniz slaytı yalnız onu yeniden seslendirerek düzeltirsiniz. İndirmeden önce **Baştan izle** ile hepsini sırayla izleyebilirsiniz.', help: 'konu-anlatimi' },
          { text: 'Konu anlatımında anlatılan madde slaytta fosforlu kalemle boyanır, anlatımı bitince yanına tik atılır. Hangi cümlenin neyi boyayacağını slaytın yanındaki **Slayttaki işaretler** listesinden değiştirebilirsiniz.', help: 'konu-anlatimi' },
        ],
      },
      {
        title: 'Seslendirme',
        items: [
          { text: 'Google o an meşgul olduğunda kelime zamanları tarayıcınızda alınamıyor ve “Ses oluşturuldu ancak kelime zamanları alınamadı” uyarısı çıkıyordu. Bu düzeltildi; işaretler sesle yine eşleşir.', help: 'seslendirme' },
        ],
      },
    ],
  },
  {
    id: '2026-10-09',
    date: '9 Ekim 2026',
    title: 'Seslendirmede adım adım ilerleme',
    groups: [
      {
        title: 'Seslendirme',
        items: [
          { text: 'Seslendirme sürerken sağda hangi aşamada olduğu görünür: soru kaydediliyor, ses üretiliyor (uzun metinde kaçıncı bölüm), birleştiriliyor, kelime zamanları alınıyor. Ne kadar süredir beklediğiniz ve olağan süre de yazar.', help: 'seslendirme' },
        ],
      },
      {
        title: 'Video ve tarayıcı',
        items: [
          { text: 'Tarayıcınız video hazırlayamıyorsa (bazı Safari ve iPad sürümleri) stüdyo bunu son adımda değil, daha açılırken söyler. Videoyu bilgisayarda güncel Chrome ya da Edge ile indirebilirsiniz.', help: 'video-indir' },
          { text: '**İşaretleri otomatik hazırla** penceresinde yalnız gerçekten yapılan üç aşama görünür: görsel okunuyor, çözüm metnindeki elemeler bulunuyor, işaretler sesle eşleştiriliyor.', help: 'isaretler' },
        ],
      },
      {
        title: 'Daha sade ve hızlı',
        items: [
          { text: 'İngilizce teknik hata mesajları yerine ne yapmanız gerektiğini söyleyen kısa Türkçe mesajlar çıkar.' },
          { text: 'Stüdyo daha hızlı açılır: bazı sayfalar ve çizim araçları ilk kullandığınızda yüklenir.' },
          { text: '**Ayarlar**’daki **Durumu Yenile** düğmesi artık sonucu yazar.', help: 'ayarlar' },
        ],
      },
    ],
  },
  {
    id: '2026-10-08',
    date: '8 Ekim 2026',
    title: 'Seslendirme mesajları sadeleşti',
    groups: [
      {
        title: 'Seslendirme',
        items: [
          { text: 'En üst düzey modelin günlük hakkı bitince stüdyo bugün kaç ses kullandığınızı yazar ve yalnız **Sonraki modele geç** ya da **Kapat** diye sorar.', help: 'seslendirme' },
          { text: 'Google o an cevap vermezse artık başka model önerilmez; “Google’dan cevap gelmedi, birkaç dakika sonra tekrar deneyin” yazar.', help: 'seslendirme' },
          { text: 'Çözüm metni Arapça başlıyorsa Ses adımı sizi uyarır: metni kısa bir Türkçe cümleyle başlatın (örneğin “Önce paragrafı okuyalım.”), yoksa ses Türkçeyi de Arap aksanıyla okur.', help: 'cozum-metni' },
          { text: 'Google bir metni seslendirmeyi kabul etmezse bunu açıkça yazar. Aynı metin aynı gün tekrar gönderilmez, böylece her denemede bir hak boşa gitmez.', help: 'seslendirme' },
        ],
      },
    ],
  },
  {
    id: '2026-10-06',
    date: '6 Ekim 2026',
    title: 'Ses yazılı son harekeyi okur',
    groups: [
      {
        title: 'Seslendirme',
        items: [
          { text: 'Ses artık Arapça kelimelerin son harekesini yazıldığı gibi okur: fetha yazılan yeri ötre okumaz, tenvini düşürmez. Bu, şıklardaki tek kelimeler ve fiiller gibi tek başına duran kelimelerde de geçerlidir.', help: 'seslendirme' },
          { text: '**Telaffuz sözlüğü** harekeli yazdığınız kelimeyi metinde farklı son harekeyle, eksik ya da fazladan harekeyle yazılmış olsa da bulur.', help: 'seslendirme' },
          { text: 'Bazı seslerde kelime zamanları yalnız Arapça kısımdan alınıyordu; bu yüzden **Sesi düzelt** “Bu sesin kelime zamanları yok” diyordu. Artık böyle bir zamanlama kullanılmaz; eski seslerde de **Sesi düzelt** önce zamanları yeniden alır, sonra seçtiğiniz cümleyi düzeltir.', help: 'seslendirme' },
        ],
      },
    ],
  },
  {
    id: '2026-10-05',
    date: '5 Ekim 2026',
    title: 'Yeni sayfa: Hazırlık araçları',
    groups: [
      {
        title: 'Düzeltmeler',
        items: [
          { text: 'Ses oluşturulduktan sonra **Ses şeridi**nin çalmaması (sayfayı yenilemeden ses gelmemesi) ve **İşaretleri otomatik hazırla** derken çıkan “Failed to fetch” hatası giderildi. Bir dosya yine de indirilemezse artık ne yapacağınızı Türkçe söyleyen bir uyarı çıkar.' },
        ],
      },
      {
        title: 'Hazırlık araçları',
        items: [
          { text: 'Sol menüde yeni **Hazırlık Araçları** sayfası var. Komisyonumuzdan bir öğretmenin hazırladığı iki araç yeni sekmede açılır: **Soru şablonu yerleştirici** soruları Bakanlık şablonuna yerleştirip resim olarak toplu indirir, **Çözüm senaryosu oluşturucu** çözüm metnini hazırlamanıza yardım eder. Hazırladığınız resmi ve metni sonra stüdyoya eklersiniz.', help: 'hazirlik-araclari' },
          { text: '**Kontrol Paneli**’nin üstündeki “Hazırlık araçlarına bakın” bağlantısı da bu sayfayı açar.', help: 'hazirlik-araclari' },
          { text: 'Her aracın kartında ve Yardım’daki rehberde aracın ekran görüntüsü var; resme tıklayınca da araç açılır.', help: 'hazirlik-araclari' },
          { text: 'Soru eklerken de araçlara ulaşabilirsiniz: **1 Soru** adımında görsel yüklenmemişken şablon aracına, **2 Metin** adımında metin kutusu boşken çözüm senaryosu aracına giden bir bağlantı görünür.', help: 'hazirlik-araclari' },
        ],
      },
      {
        title: 'Sorularım',
        items: [
          { text: '**Konu:** Sorulara konu yazabilirsiniz (soru bilgilerindeki **Konu** kutusu ya da seçili sorular için **Konu ver**). Sorularım’da konuya göre süzebilirsiniz; yönetici panelinde hangi konudan kaç soru olduğu görünür.', help: 'soru-listesi' },
          { text: '**Video bilgileri:** **5 İndir** adımında sorunun başlık, koleksiyon, soru no, konu, doğru cevap ve süresi tek yerde; **Kopyala** ile alırsınız. Sorularım’da seçili sorular için **Bilgi listesi (Excel)** hepsini tek listede indirir.', help: 'video-indir' },
          { text: '**Arka arkaya izle:** Sorularım’da soruları seçip (bir denemenin tamamı için **Tümünü seç**) alttaki çubuktan **Arka arkaya izle**’ye basın. Videolar sırayla oynar; hatalı olanı “Düzeltilecek” diye işaretlersiniz, sonunda bu sorular listelenir.', help: 'soru-listesi' },
        ],
      },
      {
        title: 'İşaretler ekranı',
        items: [
          { text: '**Ok aracı (➜):** Kuyruğundan basıp ucunun gideceği yere sürükleyin; videoda ok uzayarak gelir. Yönünü küçük çubuktan çevirebilirsiniz.', help: 'isaretler' },
          { text: '**Yazı aracı (T):** Görselin istediğiniz yerine kısa bir yazı koyun (“Fiil”, “Mef’ûl-ü bih”, Arapça da olur). Yazıyı küçük çubuktaki kutuya girersiniz.', help: 'isaretler' },
          { text: '**Renk seçimi:** Alt çizgi, daire, ok ve yazının rengini seçtiğinizde çıkan küçük çubuktan değiştirin.', help: 'isaretler' },
          { text: '**Yinele:** Geri aldığınız bir değişikliği **Yinele** düğmesiyle ya da **Ctrl+Y** ile geri getirin.', help: 'isaretler' },
          { text: '**Otomatiğe döndür:** Stüdyonun bulduğu bir kutuyu taşıdıktan ya da boyunu değiştirdikten sonra, küçük çubuktaki bu düğme kutuyu ilk bulunduğu yere döndürür.', help: 'isaretler' },
        ],
      },
      {
        title: 'Ses ve video',
        items: [
          { text: '**Telaffuz sözlüğü:** Ses bir kelimeyi yanlış okuyorsa **Ayarlar → Telaffuz sözlüğü**’ne yazılışını ve okunuşunu ekleyin (örneğin “MEB” → “Meb”). Ekrandaki ve videodaki yazı değişmez, yalnız ses böyle okur. Sözlük bütün hocalar için ortaktır.', help: 'seslendirme' },
          { text: '**Bütün videolarda aynı ses seviyesi:** İndirilen her videonun sesi aynı yüksekliğe getirilir. Öğrenci bir videodan ötekine geçince sesi açıp kısmak zorunda kalmaz; kısık kaydedilmiş MP3’ler de duyulur hâle gelir. Önizlemede ses kaydedildiği gibi çalar.', help: 'video-indir' },
        ],
      },
      {
        title: 'Mesajlar ve sorun bildirimleri',
        items: [
          { text: 'Sol menüde yeni **Mesajlar** var: stüdyo yöneticisiyle birebir yazışabilirsiniz. Yönetici size özel mesaj gönderebilir, siz de ona buradan yazabilirsiniz. Yeni mesaj gelince yanında sayı çıkar.', help: 'sorun-bildir' },
          { text: 'Gönderdiğiniz sorun bildirimlerine yönetici artık kısa bir yanıt yazabiliyor. Bildirimleriniz, durumları ve yanıtlar da **Mesajlar**’da görünür.', help: 'sorun-bildir' },
          { text: 'Duyurularda ve mesajlarda kalın yazılar artık kalın, maddeler de madde işaretli görünüyor; yanlarında yıldız çıkmıyor.', help: 'sorun-bildir' },
        ],
      },
    ],
  },
  {
    id: '2026-10-03',
    date: '3 Ekim 2026',
    title: 'Görsel okuyucu iki Arapça modelden iyi okuyanı seçiyor',
    groups: [
      {
        title: 'Görsel okuma',
        items: [
          { text: 'Stüdyonun kendi okuyucusu her görseli hem kendi eğittiğimiz Arapça modelle hem de hazır modelle okur, hangisi daha emin okuduysa onu kullanır. Kendi modelimiz Soru çöz görsellerinde, hazır model ÖSYM baskısında daha iyi. Denemelerde ÖSYM tarzı sorularda hatasız okunan satırlar 178’de 131’den 144’e çıktı; Soru çöz görsellerinde kazanç korundu.', help: 'isaretler' },
          { text: 'İkinci model ilk açılışta bir kez indirilir; ilk **İşaretleri hazırla** biraz uzun sürebilir.', help: 'isaretler' },
        ],
      },
    ],
  },
  {
    id: '2026-10-02',
    date: '2 Ekim 2026',
    title: 'Yedek ses modeli artık sorulmadan kullanılmıyor',
    groups: [
      {
        title: 'Seslendirme',
        items: [
          { text: '**Yedek modele geçmeden önce sorulur:** En üst düzey ses modelinin günlük kullanım hakkı bitince stüdyo artık sessizce yedek modele geçmez. “Yedek modelle seslendir” ya da “Yarını bekleyeceğim” diye sorar. Yedek model araya olmayan cümle katabilir, olumsuzu olumlu okuyabilir, Türkçeyi yanlış telaffuz edebilir.', help: 'seslendirme' },
          { text: 'Yedek modelle üretilen sesin altında bunu söyleyen bir not çıkar; sesi dinleyip hatalı cümleyi **Sesi düzelt** ile yenileyin.', help: 'seslendirme' },
          { text: 'Kendi Google anahtarı olan hocalarda, kendi anahtarındaki en üst düzey modelin hakkı bitince önce stüdyonun anahtarındaki en üst düzey model denenir (önceden hemen yedek modele geçiliyordu).', help: 'seslendirme' },
          { text: 'Ses adımında en üst düzey modelin bugünkü hakkı bittiyse sağdaki kullanım satırı bunu açıkça yazar (kalan haklar yedek model içindir).', help: 'seslendirme' },
          { text: 'Açık kalmış eski bir sayfada “En üst düzey modelin hakkı bitti” yazıp seçili cümle seslendirilmiyorsa sayfayı yenileyin; yenileyince soru sorulur.' },
        ],
      },
      {
        title: 'Soru görseli',
        items: [
          { text: '**Yalnız görseli değiştirin, sesi koruyun:** Ses hazırlandıktan sonra görselin yanlış olduğu anlaşılırsa **1 Soru** adımında **Görseli Değiştir** ile doğrusunu yükleyin. Ses ve çözüm metni olduğu gibi kalır, yeniden seslendirme gerekmez; işaretler yeni görsele göre kendiliğinden yeniden hazırlanır. Eski görselde elle yaptığınız işaret düzeltmeleri silinir.', help: 'yeni-soru' },
        ],
      },
      {
        title: 'Görsel okuma',
        items: [
          { text: 'Stüdyonun kendi görsel okuyucusu Arapçayı artık hocaların soru görselleriyle eğitilmiş kendi modeliyle okuyor. Denemelerde hatasız okunan satırlar 177’de 110’dan 131’e çıktı.', help: 'isaretler' },
          { text: 'Okuyucu ilk açılışta yeni modeli bir kez indirir; bu yüzden ilk **İşaretleri hazırla** biraz uzun sürebilir.', help: 'isaretler' },
        ],
      },
      {
        title: 'Düzeltmeler',
        items: [
          { text: 'Ses adımında **Cümle listesi** açıkken soru küçücük kalmıyor: liste ekran yüksekliğine göre kısalıyor, soru büyük kalıyor (kaydırarak bütün cümleler görülür).', help: 'seslendirme' },
        ],
      },
    ],
  },
  {
    id: '2026-10-01',
    date: '1 Ekim 2026',
    title: 'Daha hızlı düzenleme: alt çizgi, daire, “Şimdi”; şık düzeltmeleri',
    groups: [
      {
        title: 'İşaretler ekranı',
        items: [
          { text: '**Alt çizgi aracı (▁):** Çizginin başlayacağı yere basın, sağa ya da sola sürükleyip bırakın. Kalınlığı sabit, yalnız boyu değişir. Yazının hemen altına bırakırsanız satıra kendisi oturur; videoda çizgi sürüklediğiniz yönde akar.', help: 'isaretler' },
          { text: '**Daire aracı (◯):** Bir kelimenin ya da şıkkın etrafına elle çizilmiş gibi bir halka çizer.', help: 'isaretler' },
          { text: '**“Şimdi” ile zamanlama:** Zaman şeridinde bir işarete tıklayın, sesi oynatın. Çıkması gereken anda **Şimdi başlasın**’a (ya da Enter’a), bitmesi gereken anda **Şimdi bitsin**’e basın.', help: 'isaretler' },
          { text: '**Çarpı ve tik tıkladığınız yere konur:** Aracı seçip görselde bir noktaya tıklayın, işaret tam oraya gelir; kendisinden tutup taşıyabilir, köşesinden büyütebilirsiniz. Bir şıkka tıklarsanız eskisi gibi o şık işaretlenir.', help: 'isaretler' },
          { text: '**Çizgi yalnız çizgidir:** Çizdiğiniz çizginin etrafında kutu yok; seçince yalnız iki ucunda tutamak çıkar, ortasından tutup taşırsınız.', help: 'isaretler' },
          { text: '**Daire çizdiğiniz yere oturur** ve kendisinden tutulup taşınır, kenarlarından büyütülür.', help: 'isaretler' },
          { text: '**Küçük araç çubuğu:** Bir işareti seçince büyük pencere yerine küçük bir çubuk çıkar: saat, buraya al, sil, kopyala. Taşırken yazı satırlarına ve diğer işaretlere hizalanır.', help: 'isaretler' },
          { text: 'Büyütüp küçültünce mavi tutamaklar işaretle birlikte hemen yerine oturur.' },
          { text: 'Arka arkaya çizilen çizgilerin her biri önizlemenin durduğu anda başlar ve hemen turuncu görünür; zamanını şeritten ayarlarsınız.', help: 'isaretler' },
          { text: 'Uzun şıkları okuyan sorularda sağdaki listede yanlış “Arapça paragrafın altı çizilemedi” uyarıları artık çıkmaz (şıkların altı zaten şıkta çiziliyor). Eski sorularda **İşaretleri yeniden hazırla**’ya basınca kalkar.' },
          { text: 'Önizleme dururken eklediğiniz işaret hemen görünür (önceden oynatmadan görünmüyordu).' },
          { text: '**Uzun şıkların altı çizilir:** Çözüm bir şıkkın beş kelimeden uzun Arapça cümlesini okurken (“A seçeneğinde şöyle deniyor: …”), o cümlenin altı şıkkın kendi satırlarında, okundukça çizilir. Kısa şıklar yalnız çerçevelenir.', help: 'isaretler' },
        ],
      },
      {
        title: 'Düzeltmeler',
        items: [
          { text: 'Stüdyonun kendi görsel okuyucusu (Google’ın okuyucusu kullanılamadığında devreye giren) daha iyi okuyor: görseli büyütüp siyah-beyaz yapıyor, soluk filigranlar artık okumayı bozmuyor. Denemelerde Arapça kelimeleri doğru yerde bulma oranı %86’dan %95’e çıktı.', help: 'isaretler' },
          { text: 'İki ya da üç satıra taşan şıkların son satırı da şıkkın çerçevesine girer (Arapçada kısa son satır sağa yaslı olduğu için dışarıda kalıyordu).' },
          { text: 'Önizleme oynarken soru artık hafifçe büyüyüp küçülmüyor; boyutu sabit kalıyor.' },
          { text: 'Boşluk doldurma (cloze) sorularında, şıklar solda paragraf sağdayken E şıkkının kutusu artık paragrafa değil E şıkkının kendisine konur.' },
          { text: 'Stüdyonun yeni sürümü yayınlandığında açık sayfada mavi bir uyarı çıkar: **Sayfayı yenile**’ye basınca düzeltmeler hemen çalışır.' },
          { text: 'Ses yazıya dökülürken okunan Arapça cümle atlanırsa, o cümlenin altı artık cümle okunurken çizilir (önceden cümle bittikten sonra, bir sonraki Türkçe cümlede çiziliyordu).' },
          { text: 'Soru küçültüldüğünde üst bant ve sayfa rengi ekranın iki yanına kadar uzanır; kenarlarda beyaz boşluk kalmaz.' },
          { text: 'Google’ın okuyucusu anlık “kaynak tükendi” cevabı verdiğinde stüdyo birkaç saniye bekleyip tekrar dener; görsel gereksiz yere zayıf okuyucuyla okunmaz.' },
          { text: 'Soru küçültüldüğünde bir şık vurgulanırken yalnız soru değil bütün ekran birlikte kararıyor; kenarlarda beyaz şerit kalmıyor.' },
          { text: 'Paragrafın şıkların yanında basıldığı sorularda bir şıkkın çerçevesi artık yandaki paragrafa taşmıyor.' },
          { text: 'Bir şıkkı okurken (“A) …” ya da “A şıkkı: …”) aynı kelimeler paragrafta da geçse, paragrafın altı çizilmiyor; o anda yalnız şık gösteriliyor. Çözümde “parçada …” diye paragrafa gönderme yaparsanız çizgi yine çıkar.' },
          { text: 'Daha önce hazırlanmış sorularda düzeltmenin görünmesi için **İşaretleri yeniden hazırla**’ya basın.', help: 'isaretler' },
          { text: 'Bir sorunun görseli Google’ın okuyucusuyla bir kez okununca okuma soruyla birlikte saklanır. **İşaretleri yeniden hazırla**’ya kaç kez basarsanız basın günlük okuma hakkınızdan düşmez; günlük hakkınız bitmiş olsa bile o soru aynı kalitede hazırlanır. Görseli değiştirirseniz yeni görsel bir kez daha okunur.' },
        ],
      },
    ],
  },
  {
    id: '2026-09-30',
    date: '30 Eylül 2026',
    title: 'Alt çizgiler doğru satırda, toplu hazırlama ve tek tuşla sorun bildirme',
    groups: [
      {
        title: 'Görsel okuma ve alt çizgiler',
        items: [
          { text: 'Uzun Arapça paragraflarda her satırın altı, o satır okunurken doğru satıra çizilir; çizgilerin alt satıra kayması giderildi.' },
          { text: 'Numaralı cümleli (I, II, III…) sorularda ve filigranlı görsellerde de satırlar doğru bulunur.' },
          { text: 'Bir kelimesi yanlış okunsa bile üç ve daha uzun kelimelik Arapça ifadelerin altı tek parça çizilir.' },
          { text: 'Soru görselleri Google’ın okuyucusuyla okunur; her hocanın günde 30 okuma hakkı vardır. Hak bitince eski okuyucu devreye girer.' },
        ],
      },
      {
        title: 'İşaretler ekranı',
        items: [
          { text: 'Ses adımından sonra soru ekrana kaydırmadan sığar; küçük ekranlarda düzenleme kolaylaştı.' },
          { text: 'Yanlış bir şey görürseniz **Burada hata var**’a basın: video durur ve az önce çıkan işaretin kutusu seçilir.', help: 'isaretler' },
          { text: 'Bir kutuya tıklayınca **Hangi şık?** satırı çıkar; harfe basınca kutu o şık olur, çarpısı ya da tiki sese göre kendiliğinden gelir.', help: 'isaretler' },
          { text: 'Kutular **Ctrl+C / Ctrl+V** ile kopyalanıp yapıştırılır; Boşluk, Esc, Delete ve Ctrl+Z kısayolları çalışır.' },
          { text: 'Tik işaretinin yanındaki boş kutucuk kaldırıldı.' },
          { text: '**Sade uyarılar:** Her uyarı tek cümledir ve yanında işi yapan düğme vardır (“Görselde düzelt”, “Zamanlamayı aç” gibi).' },
          { text: '**Yardım** sayfasına Ses ve İşaretler adımları için resimli, tam rehber eklendi.', help: 'isaretler' },
        ],
      },
      {
        title: 'Ses',
        items: [
          { text: 'Yaklaşık 450 kelimeye kadar olan çözümler tek seferde, bütün hâlinde seslendirilir. Daha uzunlar yalnız cümle ya da paragraf sonlarından bölünür.', help: 'seslendirme' },
          { text: 'Seste okunan Arapça cümleler artık yanlışlıkla “okunmamış” görünmez; uyarı yalnız gerçekten atlanan yerde çıkar.' },
          { text: '“Sesi düzelt” cümleyi yerinde değiştirir, araya kopya eklemez ve önceki cümleden kırpmaz.', help: 'seslendirme' },
          { text: 'Ses servisi anlık yanıt vermezse üretilen ses kaybolmaz ve boş dönen istekler hakkınızı harcamaz. Hata görürseniz art arda basmak yerine bir iki dakika bekleyip deneyin.' },
          { text: '“Sesi düzelt” ile yeniden okunan parçanın ses yüksekliği artık çevresine göre ayarlanır; araya giren parça daha yüksek ya da kısık duyulmaz.', help: 'seslendirme' },
        ],
      },
      {
        title: 'Sorularım ve sorun bildirme',
        items: [
          { text: '**Toplu “İşaretleri hazırla”:** Sorularım’da birkaç soruyu seçip bu düğmeye basın. İşaretler sırayla hazırlanır; sonunda hangi sorunun kontrol istediği tek listede çıkar.', help: 'soru-listesi' },
          { text: '**Tek tuşla sorun bildirme:** Bir soruda işaret yanlış çıkarsa **Sorun bildir**’e basıp uygun seçeneği işaretleyin (çizgi yanlış yerde, tik yanlış şıkta, ses yanlış okudu…). Yazmanız ya da dosya indirmeniz gerekmez; sorunun bilgileri bize kendiliğinden ulaşır.', help: 'sorun-bildir' },
          { text: '**Tamamlandı:** MP4’ü indirince soru tamamlandı sayılır. Değişiklik isterseniz **Düzenlemeye geri aç** ile açabilirsiniz.', help: 'video-indir' },
        ],
      },
    ],
  },
];

const SEEN = 'studio-news-seen';
/** The newest entry this device has shown, so the menu marks only what is new. */
export const readSeen = (): string => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
const itemCount = (entry: NewsEntry) => entry.groups.reduce((n, g) => n + g.items.length, 0);
/** What was seen: the newest day and how many items it had then (a day can get more items later). */
export const newsStamp = () => `${NEWS[0].id}#${itemCount(NEWS[0])}`;
export function markNewsSeen() {
  try { localStorage.setItem(SEEN, newsStamp()); } catch { /* per-device only */ }
  window.dispatchEvent(new Event('studio-news-seen'));
}
/** Days newer than the one last seen, and that day again if it has got new items (everything on a first visit). */
export function unseenNews(seen: string): NewsEntry[] {
  if (!seen) return NEWS;
  const [day, count] = [seen.slice(0, 10), Number(seen.split('#')[1]) || 0];
  return NEWS.filter(entry => entry.id > day || (entry.id === day && itemCount(entry) > count));
}
