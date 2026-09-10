import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'ar-menu:lang'

const en = {
  'app.title': 'AR Menu Studio',
  'app.tagline': 'Photo in, AR dish out.',
  'nav.studio': 'Studio',
  'nav.menu': 'Menu',
  'lang.switch': 'العربية',

  'step.photo': 'Photo',
  'step.cutout': 'Cut-out',
  'step.model': '3D dish',
  'step.publish': 'Publish',

  'upload.prompt': 'Drop a food photo here',
  'upload.hint': 'Or tap to choose. JPEG or PNG, shot from above or at 45°, one dish per photo.',
  'upload.button': 'Choose photo',
  'upload.tips.title': 'What makes a good source photo',
  'upload.tips.1': 'One dish, centred, filling most of the frame.',
  'upload.tips.2': 'A plain surface behind it — a wooden table or a single-colour cloth.',
  'upload.tips.3': 'Even light, no hard shadow crossing the plate.',
  'upload.tips.4': 'Shoot straight down for the most convincing result on a table.',

  'cut.title': 'Separate the dish from the background',
  'cut.tolerance': 'Cut strength',
  'cut.shrink': 'Edge trim',
  'cut.feather': 'Edge softness',
  'cut.rect': 'Drag a box around the dish to limit the search',
  'cut.tool.rect': 'Box',
  'cut.tool.erase': 'Erase',
  'cut.tool.restore': 'Restore',
  'cut.brush': 'Brush',
  'cut.brushErase': 'Erase',
  'cut.brushRestore': 'Restore',
  'cut.brushSize': 'Brush size',
  'cut.recompute': 'Re-run cut-out',
  'cut.reset': 'Reset',
  'cut.coverage': 'Dish covers {value}% of the frame',
  'cut.warnSmall': 'Almost nothing survived the cut. Lower the cut strength.',
  'cut.warnLarge': 'Nearly the whole photo survived. Raise the cut strength or draw a box.',

  'model.title': 'Shape the 3D dish',
  'model.width': 'Real width',
  'model.puffiness': 'Puffiness',
  'model.back': 'Underside depth',
  'model.relief': 'Surface relief',
  'model.tilt': 'How the photo was shot',
  'model.tilt.top': 'From above',
  'model.tilt.angle': 'Three-quarter',
  'model.tilt.front': 'Straight on',
  'model.detectPlate': 'The photo already has a plate',
  'model.plate': 'Add a 3D plate underneath',
  'model.quality': 'Mesh detail',
  'model.rebuild': 'Rebuild',
  'model.stats': '{tris} triangles · {size}',
  'model.building': 'Building the mesh…',

  'details.title': 'Menu details',
  'details.name': 'Dish name (English)',
  'details.nameAr': 'اسم الطبق (Arabic)',
  'details.desc': 'Description',
  'details.price': 'Price',
  'details.currency': 'Currency',
  'details.category': 'Category',
  'details.category.starters': 'Starters',
  'details.category.mains': 'Mains',
  'details.category.grills': 'Grills',
  'details.category.desserts': 'Desserts',
  'details.category.drinks': 'Drinks',

  'action.save': 'Save to menu',
  'action.saved': 'Saved',
  'action.download': 'Download .glb',
  'action.downloadUsdz': 'Download .usdz',
  'status.usdz': 'Converting for iOS…',
  'action.viewAr': 'View on your table',
  'action.back': 'Back',
  'action.next': 'Continue',
  'action.delete': 'Delete',
  'action.export': 'Export menu',
  'action.import': 'Import menu',
  'action.startOver': 'New dish',
  'action.copyLink': 'Copy link',
  'action.copied': 'Copied',
  'action.downloadQr': 'Download QR',

  'ar.title': 'Augmented reality',
  'ar.hint': 'Point the camera at your table, then drag to place the dish.',
  'ar.ios': 'This dish has no USDZ file, so iPhone and iPad show the 3D viewer instead of camera AR. Serve the page over HTTPS and rebuild the dish to generate one.',
  'ar.iosDirect': 'Open in AR (iPhone)',
  'ar.unsupported': 'This browser has no AR mode. The dish still rotates and zooms in 3D.',

  'menu.title': 'Your AR menu',
  'menu.empty': 'No dishes yet. Build the first one in the studio.',
  'menu.count': '{count} dishes',
  'menu.count.one': '1 dish',
  'menu.qrHint': 'Print this QR next to the dish on the paper menu.',
  'menu.localOnly': 'Dishes are stored in this browser only. Export the menu to move it to another device.',
  'menu.imported': 'Imported {count} dishes.',

  'status.reading': 'Reading photo…',
  'status.segmenting': 'Removing the background…',
  'status.inflating': 'Inflating to 3D…',
  'status.exporting': 'Packing the GLB…',
  'error.generic': 'Something went wrong. Try another photo.',
}

const ar = {
  'app.title': 'استوديو قائمة الواقع المعزز',
  'app.tagline': 'صورة تدخل، طبق ثلاثي الأبعاد يخرج.',
  'nav.studio': 'الاستوديو',
  'nav.menu': 'القائمة',
  'lang.switch': 'English',

  'step.photo': 'الصورة',
  'step.cutout': 'القص',
  'step.model': 'الطبق ثلاثي الأبعاد',
  'step.publish': 'النشر',

  'upload.prompt': 'أفلت صورة الطبق هنا',
  'upload.hint': 'أو اضغط للاختيار. صيغة JPEG أو PNG، من الأعلى أو بزاوية ٤٥ درجة، طبق واحد لكل صورة.',
  'upload.button': 'اختر صورة',
  'upload.tips.title': 'ما الذي يصنع صورة مصدر جيدة',
  'upload.tips.1': 'طبق واحد في المنتصف يملأ معظم الإطار.',
  'upload.tips.2': 'خلفية بسيطة، طاولة خشبية أو قماش بلون واحد.',
  'upload.tips.3': 'إضاءة متساوية بلا ظل حاد يقطع الطبق.',
  'upload.tips.4': 'التصوير من الأعلى يعطي أفضل نتيجة على الطاولة.',

  'cut.title': 'افصل الطبق عن الخلفية',
  'cut.tolerance': 'قوة القص',
  'cut.shrink': 'تقليم الحواف',
  'cut.feather': 'نعومة الحواف',
  'cut.rect': 'ارسم مربعًا حول الطبق لتضييق البحث',
  'cut.tool.rect': 'مربع',
  'cut.tool.erase': 'مسح',
  'cut.tool.restore': 'استرجاع',
  'cut.brush': 'الفرشاة',
  'cut.brushErase': 'مسح',
  'cut.brushRestore': 'استرجاع',
  'cut.brushSize': 'حجم الفرشاة',
  'cut.recompute': 'أعد القص',
  'cut.reset': 'إعادة ضبط',
  'cut.coverage': 'الطبق يغطي {value}٪ من الإطار',
  'cut.warnSmall': 'لم يبق شيء تقريبًا بعد القص. خفّض قوة القص.',
  'cut.warnLarge': 'بقيت الصورة كاملة تقريبًا. ارفع قوة القص أو ارسم مربعًا.',

  'model.title': 'اضبط شكل الطبق',
  'model.width': 'العرض الحقيقي',
  'model.puffiness': 'الانتفاخ',
  'model.back': 'عمق الأسفل',
  'model.relief': 'تفاصيل السطح',
  'model.tilt': 'كيف صُوّرت الصورة',
  'model.tilt.top': 'من الأعلى',
  'model.tilt.angle': 'بزاوية',
  'model.tilt.front': 'من الأمام',
  'model.detectPlate': 'الصورة تحتوي على صحن',
  'model.plate': 'أضف صحنًا ثلاثي الأبعاد',
  'model.quality': 'دقة الشبكة',
  'model.rebuild': 'إعادة البناء',
  'model.stats': '{tris} مثلث · {size}',
  'model.building': 'جارٍ بناء الشبكة…',

  'details.title': 'بيانات القائمة',
  'details.name': 'اسم الطبق (إنجليزي)',
  'details.nameAr': 'اسم الطبق (عربي)',
  'details.desc': 'الوصف',
  'details.price': 'السعر',
  'details.currency': 'العملة',
  'details.category': 'التصنيف',
  'details.category.starters': 'المقبلات',
  'details.category.mains': 'الأطباق الرئيسية',
  'details.category.grills': 'المشاوي',
  'details.category.desserts': 'الحلويات',
  'details.category.drinks': 'المشروبات',

  'action.save': 'احفظ في القائمة',
  'action.saved': 'تم الحفظ',
  'action.download': 'تنزيل ملف glb.',
  'action.downloadUsdz': 'تنزيل ملف usdz.',
  'status.usdz': 'جارٍ التحويل للآيفون…',
  'action.viewAr': 'شاهده على طاولتك',
  'action.back': 'رجوع',
  'action.next': 'متابعة',
  'action.delete': 'حذف',
  'action.export': 'تصدير القائمة',
  'action.import': 'استيراد قائمة',
  'action.startOver': 'طبق جديد',
  'action.copyLink': 'نسخ الرابط',
  'action.copied': 'تم النسخ',
  'action.downloadQr': 'تنزيل رمز QR',

  'ar.title': 'الواقع المعزز',
  'ar.hint': 'وجّه الكاميرا نحو الطاولة ثم اسحب لوضع الطبق.',
  'ar.ios': 'لا يوجد ملف USDZ لهذا الطبق، لذا يعرض الآيفون والآيباد العارض ثلاثي الأبعاد بدل الكاميرا. افتح الصفحة عبر HTTPS وأعد بناء الطبق لإنشاء الملف.',
  'ar.iosDirect': 'افتح بالواقع المعزز (آيفون)',
  'ar.unsupported': 'هذا المتصفح لا يدعم الواقع المعزز. يمكنك تدوير الطبق وتكبيره ثلاثي الأبعاد.',

  'menu.title': 'قائمتك بالواقع المعزز',
  'menu.empty': 'لا توجد أطباق بعد. ابدأ الأول من الاستوديو.',
  'menu.count': '{count} طبق',
  'menu.count.one': 'طبق واحد',
  'menu.qrHint': 'اطبع رمز QR بجانب الطبق في القائمة الورقية.',
  'menu.localOnly': 'الأطباق محفوظة في هذا المتصفح فقط. صدّر القائمة لنقلها إلى جهاز آخر.',
  'menu.imported': 'تم استيراد {count} طبق.',

  'status.reading': 'جارٍ قراءة الصورة…',
  'status.segmenting': 'جارٍ إزالة الخلفية…',
  'status.inflating': 'جارٍ التحويل لثلاثي الأبعاد…',
  'status.exporting': 'جارٍ تجهيز ملف GLB…',
  'error.generic': 'حدث خطأ. جرّب صورة أخرى.',
}

const DICTIONARIES = { en, ar }

const I18nContext = createContext({ lang: 'en', dir: 'ltr', t: (key) => key, setLang: () => {} })

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem(STORAGE_KEY) || 'en')
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  const value = useMemo(() => {
    const dictionary = DICTIONARIES[lang] || en
    const t = (key, vars) => {
      let text = dictionary[key] ?? en[key] ?? key
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(replacement))
        }
      }
      return text
    }
    return { lang, dir, t, setLang }
  }, [lang, dir])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export const CURRENCIES = ['AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR']

export function formatPrice(amount, currency, lang) {
  if (amount == null || amount === '') return ''
  const value = Number(amount)
  if (!Number.isFinite(value)) return ''
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-AE' : 'en-AE', {
      style: 'currency',
      currency,
      maximumFractionDigits: ['KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2,
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}
