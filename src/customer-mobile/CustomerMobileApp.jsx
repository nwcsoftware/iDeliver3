import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Home,
  LogOut,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ideliverLoginLogo from '../assets/ideliver-logo-login.png'

const CUSTOMER_MOBILE_MODULE = 'iDeliver Customer Mobile'
const COMPANY_ID = String(import.meta.env.VITE_COMPANY_ID || '').trim() || null
const CUSTOMER_SESSION_KEY = 'ideliver_customer_mobile_session'
const CUSTOMER_LANGUAGE_KEY = 'ideliver_customer_mobile_language'

function isMissingRpc(error) {
  const message = error?.message || ''
  return error?.code === 'PGRST202' || message.includes('Could not find the function')
}

function isInvalidCredentials(error) {
  return (error?.message || '').includes('INVALID_CREDENTIALS')
}

const languageOptions = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', dir: 'ltr' },
  { code: 'ro', label: 'Romanian', nativeLabel: 'Romana', dir: 'ltr' },
]

const translations = {
  en: {
    add: 'Add',
    addRequestLines: 'Add one or more request lines',
    addressLine: 'Address line',
    addressName: 'Address name',
    addAddress: 'Add Address',
    all: 'All',
    allowed: 'Allowed',
    awaitingPickup: 'Awaiting Pickup',
    book: 'Book',
    bookDelivery: 'Book Delivery',
    cancel: 'Cancel',
    cashOnly: 'Cash Only',
    cashOnDelivery: 'Cash on delivery',
    city: 'City',
    close: 'Close',
    collection: 'Collection',
    confirmPassword: 'Confirm password',
    createAccount: 'Create Account',
    creatingAccount: 'Creating account...',
    created: 'Created',
    creditDebit: 'Credit/Debit',
    creditDebitAllowed: 'Credit/Debit Allowed',
    customerAccount: 'Customer account',
    customerCreatedRequest: 'Customer-created external request',
    customerRegistration: 'Customer Registration',
    default: 'Default',
    defaultPayment: 'Default payment',
    delete: 'Delete',
    delivered: 'Delivered',
    deliveryDate: 'Delivery date',
    deliveryDrop: 'Delivery / Drop',
    deliveryDropLocation: 'Delivery / drop location',
    deliveryLocationRequired: 'Delivery/drop location is required.',
    deliveryOrder: 'Delivery Order',
    deliveryStatus: 'Delivery status',
    deliveryStatusUpdated: 'Delivery status updated',
    deliveryTime: 'Delivery time',
    drop: 'Drop',
    edit: 'Edit',
    editAddress: 'Edit Address',
    editOrder: 'Edit Order',
    email: 'Email',
    emailAddress: 'Email address',
    endTime: 'End time',
    emailRequiredForOtp: 'Enter your email address to receive OTP by email.',
    enterEmailOtp: 'Enter temporary OTP 1234 sent by Email.',
    enterFullName: 'Enter full name',
    enterMobileNumber: 'Enter mobile number',
    enterOtp: 'Enter the 4 digit OTP.',
    enterPassword: 'Enter your password.',
    enterRequirement: 'Enter requirement',
    enterUsername: 'Enter a username',
    externalRequest: 'External request',
    finalDeliveryLocation: 'Final delivery location',
    firstTimeOtp: 'First-time customer? Register with OTP',
    firstTimeSetup: 'First-time customer setup',
    fullName: 'Full name',
    futureModule: 'Future module',
    home: 'Home',
    invoice: 'Invoice',
    itemsRequirements: 'Items / Requirements',
    invalidCredentials: 'Invalid mobile/email or password.',
    invalidOtp: 'Invalid OTP. Use the temporary development OTP 1234.',
    language: 'Language',
    languageSaved: 'Language saved for this device and customer session.',
    languageSubtitle: 'Choose app display language',
    latestOrder: 'Latest Order',
    latestOrderSubtitle: 'Most recent delivery request',
    loadingAccount: 'Loading account...',
    loadingOrders: 'Loading orders...',
    loadingProfile: 'Loading profile...',
    login: 'Login',
    loginFailed: 'Login failed. Please try again.',
    loginLoading: 'Logging in...',
    loginWithGoogle: 'Login with Google',
    loginSubtitle: 'Login with mobile/email and password',
    logout: 'Logout',
    minimumCharacters: 'Minimum 8 characters',
    mobile: 'Mobile',
    mobileEmail: 'Mobile number or Email',
    mobileEmailPlaceholder: 'Mobile number or email',
    mobileNumber: 'Mobile number',
    mobileNumberRequired: 'Mobile number is required.',
    mobileSubtitle: 'Used for login and WhatsApp',
    myOrders: 'My Orders',
    noAddressLine: 'No address line',
    noDate: 'No date',
    noItemRows: 'No item rows available.',
    noOrderSelected: 'No order selected',
    noOrdersFound: 'No orders found',
    noOrdersYet: 'No orders yet',
    noPaymentCollected: 'No payment collected yet',
    noReference: 'No reference',
    noSavedAddresses: 'No saved addresses yet.',
    notAllowed: 'Not allowed',
    notAvailable: 'Not available',
    notProvided: 'Not provided',
    notScheduled: 'Not scheduled',
    notSet: 'Not set',
    notes: 'Notes',
    notesIfNeeded: 'Notes, if needed',
    notifications: 'Notifications',
    orderDetails: 'Order Details',
    orderStatus: 'Order status',
    orders: 'Orders',
    password: 'Password',
    passwordConfirmationMismatch: 'Password and confirmation do not match.',
    passwordPlaceholder: 'Password',
    passwordTooShort: 'Password must be at least 8 characters.',
    payment: 'Payment',
    paymentCollections: 'Payment Collections',
    paymentStatus: 'Payment status',
    pending: 'Pending',
    confirmed: 'Confirmed',
    assigned: 'Assigned',
    pickedUp: 'Picked Up',
    inTransit: 'In Transit',
    done: 'Done',
    now: 'Now',
    stopped: 'Stopped',
    phone: 'Phone',
    photo: 'Photo',
    pickup: 'Pickup',
    pickupDrop: 'Pickup & Drop',
    pickupDate: 'Pickup date',
    pickupLocation: 'Pickup location',
    pickupLocationRequired: 'Pickup location is required.',
    pickupSubtitle: 'Choose saved address or type new',
    pickupTime: 'Pickup time',
    preferences: 'Preferences',
    primary: 'Primary',
    primaryAddress: 'Primary address',
    profile: 'Profile',
    profileSubtitle: 'Account and saved addresses',
    qty: 'Qty',
    reference: 'Reference',
    requiredOnlyForEmailOtp: 'Required only for email OTP',
    requirementRows: 'Requirement Rows',
    retailGoodsInvoices: 'Retail Goods Invoices',
    save: 'Save',
    saveChanges: 'Save Changes',
    saved: 'Saved',
    savedBackToOrderItems: 'Saved back to order_items',
    savedAddresses: 'Saved Addresses',
    savedAddressesSubtitle: 'Used for pickup and drop locations',
    saving: 'Saving...',
    schedule: 'Schedule',
    searchOrderNumber: 'Search order number',
    selectCustomer: 'Select a customer before submitting.',
    selectImage: 'Select an image file.',
    selectOrderFromOrders: 'Select an order from My Orders.',
    sendOtp: 'Send OTP',
    sendOtpThrough: 'Send OTP through',
    setPrimary: 'Set primary',
    shopProducts: 'Shop Products',
    startTime: 'Start time',
    statusTimeline: 'Status Timeline',
    submitRequest: 'Submit Request',
    submitting: 'Submitting...',
    tellUsNeed: 'Tell us what you need',
    temporaryOtp: 'Temporary development OTP is 1234.',
    totalAmount: 'Total amount',
    trackBookings: 'Track bookings, invoices and payments',
    trackStatus: 'Track status',
    typeCustomerRequirement: 'Type customer requirement',
    typeNew: 'Type new',
    unpaid: 'Unpaid',
    updateMobileNumber: 'Update Mobile Number',
    username: 'Username',
    usernamePlaceholder: 'Username, mobile, or email',
    usernameRequired: 'Username is required.',
    verifyOtp: 'Verify OTP',
    verifyOtpCreate: 'Verify OTP & Create Account',
    view: 'View',
    viewOrders: 'View Orders',
    waiting: 'Waiting',
    waitingForQuotation: 'Waiting for quotation',
    welcomeBack: 'Welcome back',
    whatsapp: 'WhatsApp',
    yourOrderNow: '{{order}} is now {{status}}.',
    yourSubmittedRequests: 'Your submitted delivery requests will appear here.',
  },
  ar: {
    add: 'إضافة',
    addAddress: 'إضافة عنوان',
    addRequestLines: 'أضف سطرا واحدا أو أكثر',
    addressLine: 'سطر العنوان',
    addressName: 'اسم العنوان',
    all: 'الكل',
    allowed: 'مسموح',
    awaitingPickup: 'بانتظار الاستلام',
    book: 'حجز',
    bookDelivery: 'حجز توصيل',
    cancel: 'إلغاء',
    cashOnly: 'نقدا فقط',
    cashOnDelivery: 'الدفع عند التسليم',
    city: 'المدينة',
    close: 'إغلاق',
    collection: 'تحصيل',
    confirmPassword: 'تأكيد كلمة المرور',
    createAccount: 'إنشاء حساب',
    creatingAccount: 'جاري إنشاء الحساب...',
    created: 'تم الإنشاء',
    creditDebit: 'ائتمان/مدين',
    creditDebitAllowed: 'ائتمان/مدين مسموح',
    customerAccount: 'حساب العميل',
    customerCreatedRequest: 'طلب خارجي من العميل',
    customerRegistration: 'تسجيل العميل',
    default: 'افتراضي',
    defaultPayment: 'طريقة الدفع الافتراضية',
    delete: 'حذف',
    delivered: 'تم التسليم',
    deliveryDate: 'تاريخ التوصيل',
    deliveryDrop: 'التوصيل / التسليم',
    deliveryDropLocation: 'موقع التوصيل / التسليم',
    deliveryLocationRequired: 'موقع التوصيل مطلوب.',
    deliveryOrder: 'طلب توصيل',
    deliveryStatus: 'حالة التوصيل',
    deliveryStatusUpdated: 'تم تحديث حالة التوصيل',
    deliveryTime: 'وقت التوصيل',
    drop: 'التسليم',
    edit: 'تعديل',
    editAddress: 'تعديل العنوان',
    editOrder: 'تعديل الطلب',
    email: 'البريد الإلكتروني',
    emailAddress: 'عنوان البريد الإلكتروني',
    endTime: 'وقت الانتهاء',
    emailRequiredForOtp: 'أدخل البريد الإلكتروني لاستلام رمز OTP.',
    enterEmailOtp: 'أدخل رمز OTP المؤقت 1234 المرسل عبر البريد.',
    enterFullName: 'أدخل الاسم الكامل',
    enterMobileNumber: 'أدخل رقم الجوال',
    enterOtp: 'أدخل رمز OTP المكون من 4 أرقام.',
    enterPassword: 'أدخل كلمة المرور.',
    enterRequirement: 'أدخل الطلب',
    enterUsername: 'أدخل اسم المستخدم',
    externalRequest: 'طلب خارجي',
    finalDeliveryLocation: 'موقع التوصيل النهائي',
    firstTimeOtp: 'عميل جديد؟ سجل باستخدام OTP',
    firstTimeSetup: 'إعداد عميل جديد',
    fullName: 'الاسم الكامل',
    futureModule: 'ميزة لاحقة',
    home: 'الرئيسية',
    invoice: 'الفاتورة',
    itemsRequirements: 'العناصر / المتطلبات',
    invalidCredentials: 'رقم الجوال/البريد أو كلمة المرور غير صحيحة.',
    invalidOtp: 'رمز OTP غير صحيح. استخدم الرمز المؤقت 1234.',
    language: 'اللغة',
    languageSaved: 'تم حفظ اللغة لهذا الجهاز وجلسة العميل.',
    languageSubtitle: 'اختر لغة عرض التطبيق',
    latestOrder: 'آخر طلب',
    latestOrderSubtitle: 'أحدث طلب توصيل',
    loadingAccount: 'جاري تحميل الحساب...',
    loadingOrders: 'جاري تحميل الطلبات...',
    loadingProfile: 'جاري تحميل الملف...',
    login: 'تسجيل الدخول',
    loginFailed: 'فشل تسجيل الدخول. حاول مرة أخرى.',
    loginLoading: 'جاري تسجيل الدخول...',
    loginWithGoogle: 'تسجيل الدخول بواسطة Google',
    loginSubtitle: 'تسجيل الدخول بالجوال/البريد وكلمة المرور',
    logout: 'تسجيل الخروج',
    minimumCharacters: '8 أحرف على الأقل',
    mobile: 'الجوال',
    mobileEmail: 'رقم الجوال أو البريد الإلكتروني',
    mobileEmailPlaceholder: 'رقم الجوال أو البريد الإلكتروني',
    mobileNumber: 'رقم الجوال',
    mobileNumberRequired: 'رقم الجوال مطلوب.',
    mobileSubtitle: 'يستخدم لتسجيل الدخول وواتساب',
    myOrders: 'طلباتي',
    noAddressLine: 'لا يوجد سطر عنوان',
    noDate: 'لا يوجد تاريخ',
    noItemRows: 'لا توجد عناصر.',
    noOrderSelected: 'لم يتم اختيار طلب',
    noOrdersFound: 'لا توجد طلبات',
    noOrdersYet: 'لا توجد طلبات بعد',
    noPaymentCollected: 'لم يتم تحصيل أي دفعة بعد',
    noReference: 'لا يوجد مرجع',
    noSavedAddresses: 'لا توجد عناوين محفوظة.',
    notAllowed: 'غير مسموح',
    notAvailable: 'غير متاح',
    notProvided: 'غير متوفر',
    notScheduled: 'غير مجدول',
    notSet: 'غير محدد',
    notes: 'ملاحظات',
    notesIfNeeded: 'ملاحظات إذا لزم الأمر',
    notifications: 'الإشعارات',
    orderDetails: 'تفاصيل الطلب',
    orderStatus: 'حالة الطلب',
    orders: 'الطلبات',
    password: 'كلمة المرور',
    passwordConfirmationMismatch: 'كلمة المرور والتأكيد غير متطابقين.',
    passwordPlaceholder: 'كلمة المرور',
    passwordTooShort: 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.',
    payment: 'الدفع',
    paymentCollections: 'تحصيلات الدفع',
    paymentStatus: 'حالة الدفع',
    pending: 'قيد الانتظار',
    confirmed: 'مؤكد',
    assigned: 'تم التعيين',
    pickedUp: 'تم الاستلام',
    inTransit: 'قيد التوصيل',
    done: 'تم',
    now: 'الآن',
    stopped: 'متوقف',
    phone: 'الهاتف',
    photo: 'صورة',
    pickup: 'الاستلام',
    pickupDrop: 'الاستلام والتسليم',
    pickupDate: 'تاريخ الاستلام',
    pickupLocation: 'موقع الاستلام',
    pickupLocationRequired: 'موقع الاستلام مطلوب.',
    pickupSubtitle: 'اختر عنوانا محفوظا أو اكتب عنوانا جديدا',
    pickupTime: 'وقت الاستلام',
    preferences: 'التفضيلات',
    primary: 'أساسي',
    primaryAddress: 'العنوان الأساسي',
    profile: 'الملف',
    profileSubtitle: 'الحساب والعناوين المحفوظة',
    qty: 'الكمية',
    reference: 'المرجع',
    requiredOnlyForEmailOtp: 'مطلوب فقط لرمز البريد',
    requirementRows: 'سطور المتطلبات',
    retailGoodsInvoices: 'فواتير البضائع',
    save: 'حفظ',
    saveChanges: 'حفظ التغييرات',
    saved: 'محفوظ',
    savedBackToOrderItems: 'محفوظ في عناصر الطلب',
    savedAddresses: 'العناوين المحفوظة',
    savedAddressesSubtitle: 'تستخدم للاستلام والتسليم',
    saving: 'جاري الحفظ...',
    schedule: 'الجدول',
    searchOrderNumber: 'ابحث برقم الطلب',
    selectCustomer: 'اختر عميلا قبل الإرسال.',
    selectImage: 'اختر ملف صورة.',
    selectOrderFromOrders: 'اختر طلبا من طلباتي.',
    sendOtp: 'إرسال OTP',
    sendOtpThrough: 'إرسال OTP عبر',
    setPrimary: 'تعيين كأساسي',
    shopProducts: 'تسوق المنتجات',
    startTime: 'وقت البداية',
    statusTimeline: 'خط الحالة',
    submitRequest: 'إرسال الطلب',
    submitting: 'جاري الإرسال...',
    tellUsNeed: 'أخبرنا بما تحتاج',
    temporaryOtp: 'رمز OTP المؤقت هو 1234.',
    totalAmount: 'المبلغ الإجمالي',
    trackBookings: 'تتبع الحجوزات والفواتير والمدفوعات',
    trackStatus: 'تتبع الحالة',
    typeCustomerRequirement: 'اكتب طلب العميل',
    typeNew: 'اكتب جديد',
    unpaid: 'غير مدفوع',
    updateMobileNumber: 'تحديث رقم الجوال',
    username: 'اسم المستخدم',
    usernamePlaceholder: 'اسم المستخدم أو الجوال أو البريد',
    usernameRequired: 'اسم المستخدم مطلوب.',
    verifyOtp: 'تحقق من OTP',
    verifyOtpCreate: 'تحقق من OTP وأنشئ الحساب',
    view: 'عرض',
    viewOrders: 'عرض الطلبات',
    waiting: 'انتظار',
    waitingForQuotation: 'بانتظار التسعير',
    welcomeBack: 'أهلا بعودتك',
    whatsapp: 'واتساب',
    yourOrderNow: '{{order}} الآن {{status}}.',
    yourSubmittedRequests: 'ستظهر طلبات التوصيل هنا.',
  },
}

translations.fr = {
  ...translations.en,
  add: 'Ajouter',
  addAddress: 'Ajouter une adresse',
  addRequestLines: 'Ajouter une ou plusieurs lignes',
  all: 'Tous',
  allowed: 'Autorise',
  awaitingPickup: 'En attente de ramassage',
  book: 'Reserver',
  bookDelivery: 'Reserver une livraison',
  cancel: 'Annuler',
  cashOnly: 'Paiement comptant',
  cashOnDelivery: 'Paiement a la livraison',
  close: 'Fermer',
  createAccount: 'Creer un compte',
  creatingAccount: 'Creation du compte...',
  created: 'Cree',
  creditDebit: 'Credit/Debit',
  customerAccount: 'Compte client',
  customerRegistration: 'Inscription client',
  delete: 'Supprimer',
  delivered: 'Livre',
  deliveryStatus: 'Statut de livraison',
  deliveryStatusUpdated: 'Statut de livraison mis a jour',
  edit: 'Modifier',
  editOrder: 'Modifier la commande',
  email: 'Email',
  endTime: 'Heure de fin',
  externalRequest: 'Demande externe',
  firstTimeOtp: 'Nouveau client ? Inscription avec OTP',
  firstTimeSetup: 'Configuration nouveau client',
  fullName: 'Nom complet',
  futureModule: 'Module futur',
  home: 'Accueil',
  invoice: 'Facture',
  language: 'Langue',
  languageSaved: 'Langue enregistree pour cet appareil et cette session.',
  languageSubtitle: 'Choisir la langue de l application',
  latestOrder: 'Derniere commande',
  loadingAccount: 'Chargement du compte...',
  loadingOrders: 'Chargement des commandes...',
  loadingProfile: 'Chargement du profil...',
  login: 'Connexion',
  loginLoading: 'Connexion...',
  loginWithGoogle: 'Connexion avec Google',
  loginSubtitle: 'Connexion avec mobile/email et mot de passe',
  logout: 'Deconnexion',
  mobileNumber: 'Numero mobile',
  myOrders: 'Mes commandes',
  noOrdersFound: 'Aucune commande trouvee',
  noOrdersYet: 'Aucune commande pour le moment',
  notAllowed: 'Non autorise',
  notProvided: 'Non fourni',
  notSet: 'Non defini',
  notes: 'Notes',
  notifications: 'Notifications',
  orderDetails: 'Details de commande',
  orders: 'Commandes',
  password: 'Mot de passe',
  payment: 'Paiement',
  pending: 'En attente',
  confirmed: 'Confirme',
  assigned: 'Assigne',
  pickedUp: 'Ramasse',
  inTransit: 'En transit',
  done: 'Termine',
  now: 'Maintenant',
  stopped: 'Arrete',
  phone: 'Telephone',
  photo: 'Photo',
  pickup: 'Ramassage',
  pickupDrop: 'Ramassage et depot',
  preferences: 'Preferences',
  primary: 'Principal',
  profile: 'Profil',
  profileSubtitle: 'Compte et adresses enregistrees',
  save: 'Enregistrer',
  saveChanges: 'Enregistrer',
  savedAddresses: 'Adresses enregistrees',
  savedBackToOrderItems: 'Enregistre dans order_items',
  saving: 'Enregistrement...',
  schedule: 'Planning',
  searchOrderNumber: 'Rechercher numero de commande',
  sendOtp: 'Envoyer OTP',
  shopProducts: 'Acheter des produits',
  submitRequest: 'Envoyer la demande',
  submitting: 'Envoi...',
  totalAmount: 'Montant total',
  trackStatus: 'Suivre le statut',
  unpaid: 'Non paye',
  updateMobileNumber: 'Mettre a jour le mobile',
  username: 'Nom utilisateur',
  usernamePlaceholder: 'Nom utilisateur, mobile, ou email',
  usernameRequired: 'Nom utilisateur requis.',
  verifyOtp: 'Verifier OTP',
  view: 'Voir',
  viewOrders: 'Voir les commandes',
  waiting: 'En attente',
  waitingForQuotation: 'En attente du devis',
  welcomeBack: 'Bon retour',
  whatsapp: 'WhatsApp',
}

translations.ro = {
  ...translations.en,
  add: 'Adauga',
  addAddress: 'Adauga adresa',
  addRequestLines: 'Adauga una sau mai multe linii',
  all: 'Toate',
  allowed: 'Permis',
  awaitingPickup: 'In asteptarea ridicarii',
  book: 'Rezerva',
  bookDelivery: 'Rezerva livrare',
  cancel: 'Anuleaza',
  cashOnly: 'Doar numerar',
  cashOnDelivery: 'Plata la livrare',
  close: 'Inchide',
  createAccount: 'Creeaza cont',
  creatingAccount: 'Se creeaza contul...',
  created: 'Creat',
  creditDebit: 'Credit/Debit',
  customerAccount: 'Cont client',
  customerRegistration: 'Inregistrare client',
  delete: 'Sterge',
  delivered: 'Livrat',
  deliveryStatus: 'Status livrare',
  deliveryStatusUpdated: 'Statusul livrarii a fost actualizat',
  edit: 'Editeaza',
  editOrder: 'Editeaza comanda',
  email: 'Email',
  endTime: 'Ora de final',
  externalRequest: 'Cerere externa',
  firstTimeOtp: 'Client nou? Inregistrare cu OTP',
  firstTimeSetup: 'Configurare client nou',
  fullName: 'Nume complet',
  futureModule: 'Modul viitor',
  home: 'Acasa',
  invoice: 'Factura',
  language: 'Limba',
  languageSaved: 'Limba a fost salvata pentru acest dispozitiv si sesiune.',
  languageSubtitle: 'Alege limba aplicatiei',
  latestOrder: 'Ultima comanda',
  loadingAccount: 'Se incarca contul...',
  loadingOrders: 'Se incarca comenzile...',
  loadingProfile: 'Se incarca profilul...',
  login: 'Autentificare',
  loginLoading: 'Autentificare...',
  loginWithGoogle: 'Autentificare cu Google',
  loginSubtitle: 'Autentificare cu mobil/email si parola',
  logout: 'Iesire',
  mobileNumber: 'Numar mobil',
  myOrders: 'Comenzile mele',
  noOrdersFound: 'Nu s-au gasit comenzi',
  noOrdersYet: 'Nu exista comenzi inca',
  notAllowed: 'Nepermis',
  notProvided: 'Nefurnizat',
  notSet: 'Nesetat',
  notes: 'Note',
  notifications: 'Notificari',
  orderDetails: 'Detalii comanda',
  orders: 'Comenzi',
  password: 'Parola',
  payment: 'Plata',
  pending: 'In asteptare',
  confirmed: 'Confirmat',
  assigned: 'Alocat',
  pickedUp: 'Ridicat',
  inTransit: 'In tranzit',
  done: 'Gata',
  now: 'Acum',
  stopped: 'Oprit',
  phone: 'Telefon',
  photo: 'Foto',
  pickup: 'Ridicare',
  pickupDrop: 'Ridicare si livrare',
  preferences: 'Preferinte',
  primary: 'Principal',
  profile: 'Profil',
  profileSubtitle: 'Cont si adrese salvate',
  save: 'Salveaza',
  saveChanges: 'Salveaza',
  savedAddresses: 'Adrese salvate',
  savedBackToOrderItems: 'Salvat in order_items',
  saving: 'Se salveaza...',
  schedule: 'Program',
  searchOrderNumber: 'Cauta numar comanda',
  sendOtp: 'Trimite OTP',
  shopProducts: 'Cumpara produse',
  submitRequest: 'Trimite cererea',
  submitting: 'Se trimite...',
  totalAmount: 'Suma totala',
  trackStatus: 'Urmareste statusul',
  unpaid: 'Neplatit',
  updateMobileNumber: 'Actualizeaza mobilul',
  username: 'Utilizator',
  usernamePlaceholder: 'Utilizator, mobil, sau email',
  usernameRequired: 'Utilizatorul este obligatoriu.',
  verifyOtp: 'Verifica OTP',
  view: 'Vezi',
  viewOrders: 'Vezi comenzile',
  waiting: 'Asteptare',
  waitingForQuotation: 'Se asteapta oferta',
  welcomeBack: 'Bine ai revenit',
  whatsapp: 'WhatsApp',
}

const statusTranslations = {
  pending: 'pending',
  confirmed: 'confirmed',
  assigned: 'assigned',
  delivered: 'delivered',
  unpaid: 'unpaid',
  'Awaiting Pickup': 'awaitingPickup',
  'Picked Up': 'pickedUp',
  'In Transit': 'inTransit',
  Delivered: 'delivered',
  Done: 'done',
  Now: 'now',
  Stopped: 'stopped',
  Waiting: 'waiting',
}

const I18nContext = createContext({
  language: 'en',
  dir: 'ltr',
  setLanguage: () => {},
  t: key => key,
})

const initialRequirements = [
  'Buy 1 packet milk',
  'Buy 2 water bottles',
  'Pick up from school',
]

const emptyAddressForm = {
  address_name: '',
  reference: '',
  address_line: '',
  city: '',
  phone: '',
  notes: '',
  is_primary: false,
}

function normalizeLanguage(language) {
  return languageOptions.some(option => option.code === language) ? language : 'en'
}

function interpolate(template, values = {}) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '')
}

function useI18n() {
  return useContext(I18nContext)
}

function translate(language, key, values) {
  const normalized = normalizeLanguage(language)
  return interpolate(translations[normalized]?.[key] || translations.en[key] || key, values)
}

function translatedStatus(t, status) {
  if (!status) return ''
  return t(statusTranslations[status] || statusTranslations[String(status).toLowerCase()] || status)
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

function statusClass(status) {
  const key = status?.toLowerCase()
  if (key === 'awaiting pickup') return 'bg-amber-100 text-amber-700'
  if (key === 'picked up') return 'bg-blue-100 text-blue-700'
  if (key === 'in transit') return 'bg-cyan-100 text-cyan-700'
  if (key === 'pending') return 'bg-amber-100 text-amber-700'
  if (key === 'confirmed') return 'bg-blue-100 text-blue-700'
  if (key === 'completed' || key === 'delivered') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

function customerRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/customer\/?/, '')
  const route = hash.split('?')[0] || 'home'
  if (['login', 'otp', 'home', 'book', 'orders', 'profile'].includes(route)) return route
  return 'home'
}

function isDevelopmentBypass() {
  return window.location.hash.includes('dev=1')
}

function setCustomerHash(screen) {
  const route = screen === 'home' ? '#/customer' : `#/customer/${screen}`
  if (window.location.hash !== route) window.history.replaceState(null, '', route)
}

function loadCustomerSession() {
  try {
    const raw = localStorage.getItem(CUSTOMER_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const age = Date.now() - new Date(session.logged_in_at).getTime()
    if (age > 12 * 60 * 60 * 1000) {
      localStorage.removeItem(CUSTOMER_SESSION_KEY)
      return null
    }
    return session
  } catch {
    localStorage.removeItem(CUSTOMER_SESSION_KEY)
    return null
  }
}

function saveCustomerSession(user) {
  const session = { ...user, logged_in_at: new Date().toISOString() }
  localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session))
  return session
}

function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_SESSION_KEY)
}

function Shell({ children, activeTab, onTab }) {
  const { t, dir } = useI18n()
  const nav = [
    { id: 'home', label: t('home'), icon: Home },
    { id: 'orders', label: t('orders'), icon: ClipboardList },
    { id: 'book', label: t('book'), icon: Plus },
    { id: 'profile', label: t('profile'), icon: User },
  ]

  return (
    <div className="h-screen overflow-hidden bg-[#eaf8fb] text-[#071923]" dir={dir}>
      <div className="relative mx-auto flex h-screen max-w-md flex-col overflow-hidden bg-[#f8fdff] shadow-2xl shadow-cyan-950/10">
        <div className="flex-1 overflow-y-auto pb-20">{children}</div>
        <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-sky-100 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="grid grid-cols-4 gap-2">
            {nav.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTab(item.id)}
                  className={cx(
                    'flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition',
                    active ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:bg-sky-50 hover:text-sky-700'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}

function Header({ title, subtitle, right, back, onBack }) {
  return (
    <header className="sticky top-0 z-10 rounded-b-[2rem] border-b border-sky-50 bg-white/95 px-5 pb-6 pt-5 shadow-sm shadow-sky-100/70 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <button type="button" onClick={onBack} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    </header>
  )
}

function DeliveryStatusNotice({ notice, onClose, onOpenOrders }) {
  const { t } = useI18n()
  if (!notice) return null

  return (
    <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-sky-200 bg-white p-4 shadow-lg shadow-sky-200/70">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-950">{t('deliveryStatusUpdated')}</p>
          <p className="mt-1 text-sm text-slate-500">
            {t('yourOrderNow', { order: notice.orderNumber || t('orderDetails'), status: translatedStatus(t, notice.deliveryStatus) })}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onOpenOrders} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">
              {t('viewOrders')}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs font-bold text-slate-500">
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children, action }) {
  return (
    <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function LoginScreen({ onLogin, onOtp, onGoogleLogin }) {
  const { t, dir } = useI18n()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function customerLogin(login, secret) {
    const contactLogin = await supabase.rpc('customer_contact_login', {
      p_login: login,
      p_password: secret,
    })
    if (!isMissingRpc(contactLogin.error)) return contactLogin

    const legacyLogin = await supabase.rpc('customer_login', {
      p_login: login,
      p_password: secret,
    })
    if (!isInvalidCredentials(legacyLogin.error)) return legacyLogin

    return supabase.rpc('verify_login', {
      p_login: login,
      p_password: secret,
    })
  }

  function loginMessage(loginError) {
    const msg = loginError?.message || ''
    if (msg.includes('INVALID_CREDENTIALS')) return t('invalidCredentials')
    if (msg.includes('ACCOUNT_LOCKED')) return 'Account locked. Please try again later.'
    if (msg.includes('ACCOUNT_SUSPENDED')) return 'This account is suspended. Please contact support.'
    if (msg.includes('customer_contact_login') || msg.includes('customer_login')) {
      return 'Customer login is not configured in Supabase. Please run the customer auth SQL.'
    }
    return msg || t('loginFailed')
  }

  async function submitLogin(event) {
    event.preventDefault()
    setError('')

    if (!identifier.trim()) {
      setError(t('mobileEmailPlaceholder'))
      return
    }
    if (!password) {
      setError(t('enterPassword'))
      return
    }

    setLoading(true)
    const { data, error: loginError } = await customerLogin(identifier.trim(), password)
    setLoading(false)

    if (loginError) {
      setError(loginMessage(loginError))
      return
    }

    const user = data?.[0]
    if (!user) {
      setError(t('invalidCredentials'))
      return
    }
    if (!user.contact_id) {
      setError('Customer profile is not linked to this login.')
      return
    }

    onLogin(saveCustomerSession(user))
  }

  async function submitGoogleLogin() {
    setError('')
    setLoading(true)
    try {
      await onGoogleLogin()
    } catch (googleError) {
      setError(googleError.message || t('loginFailed'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[#eaf8fb] px-5 py-6 text-[#071923]" dir={dir}>
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md items-center">
        <form onSubmit={submitLogin} className="w-full rounded-lg border border-sky-100 bg-white p-5 shadow-sm shadow-sky-100/70">
          <div className="mb-7 text-center">
            <img src={ideliverLoginLogo} alt="iDeliver" className="mx-auto h-20 w-auto object-contain" />
            <h1 className="mt-6 text-3xl font-bold tracking-tight">{t('welcomeBack')}</h1>
            <p className="mt-2 text-sm text-slate-500">{t('loginSubtitle')}</p>
          </div>

          <label className="block text-xs font-semibold text-slate-500">{t('username')}</label>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-sky-300"
            value={identifier}
            onChange={event => { setIdentifier(event.target.value); setError('') }}
            placeholder={t('usernamePlaceholder')}
            autoComplete="username"
            disabled={loading}
          />

          <label className="mt-5 block text-xs font-semibold text-slate-500">{t('password')}</label>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-sky-300"
            type="password"
            value={password}
            onChange={event => { setPassword(event.target.value); setError('') }}
            placeholder={t('passwordPlaceholder')}
            autoComplete="current-password"
            disabled={loading}
          />

          {error && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="mt-8 flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white shadow-sm shadow-sky-200 disabled:cursor-not-allowed disabled:bg-slate-300">
            {loading ? t('loginLoading') : t('login')}
          </button>
          <button type="button" onClick={submitGoogleLogin} disabled={loading} className="mt-3 flex h-11 w-full items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-700 disabled:opacity-60">
            {t('loginWithGoogle')}
          </button>
          <button type="button" onClick={onOtp} className="mt-4 flex h-10 w-full items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">
            {t('firstTimeOtp')}
          </button>
        </form>
      </div>
    </div>
  )
}

function OtpScreen({ onDone, onBack, onGoogleLogin }) {
  const { t, dir } = useI18n()
  const [step, setStep] = useState('details')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [otpChannel, setOtpChannel] = useState('whatsapp')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  function sendOtp(event) {
    event.preventDefault()
    setError('')

    if (!fullName.trim()) {
      setError(t('enterFullName'))
      return
    }
    if (!mobile.trim()) {
      setError(t('enterMobileNumber'))
      return
    }
    if (!username.trim()) {
      setError(t('usernameRequired'))
      return
    }
    if (otpChannel === 'email' && !email.trim()) {
      setError(t('emailRequiredForOtp'))
      return
    }
    if (password.length < 8) {
      setError(t('passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('passwordConfirmationMismatch'))
      return
    }

    setStep('otp')
  }

  function updateOtp(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1)
    setOtp(current => current.map((item, i) => (i === index ? digit : item)))
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setError('')

    if (otp.some(digit => !digit)) {
      setError(t('enterOtp'))
      return
    }
    if (otp.join('') !== '1234') {
      setError(t('invalidOtp'))
      return
    }

    setSaving(true)
    try {
      await onDone({
        mobile: mobile.trim(),
        email: email.trim() || null,
        username: username.trim(),
        otp_channel: otpChannel,
        full_name: fullName.trim(),
        password,
      })
    } catch (registrationError) {
      setError(registrationError.message || 'Customer registration failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function submitGoogleLogin() {
    if (!onGoogleLogin) return
    setError('')
    setGoogleLoading(true)
    try {
      await onGoogleLogin()
    } catch (googleError) {
      setError(googleError.message || t('loginFailed'))
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-dvh overflow-y-auto bg-[#eaf8fb] text-[#071923]" dir={dir}>
      <div className="mx-auto min-h-dvh max-w-md bg-[#f8fdff] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Header title={t('customerRegistration')} subtitle={t('firstTimeSetup')} back onBack={step === 'otp' ? () => setStep('details') : onBack} />
        <main className="space-y-3 px-4 py-4">
          {step === 'details' && (
            <button type="button" onClick={submitGoogleLogin} disabled={googleLoading || saving} className="flex h-11 w-full items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-700 shadow-sm shadow-sky-100 disabled:opacity-60">
              {googleLoading ? t('loginLoading') : t('loginWithGoogle')}
            </button>
          )}
          {step === 'details' ? (
            <form onSubmit={sendOtp}>
              <Section title={t('createAccount')} subtitle={t('temporaryOtp')}>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">{t('fullName')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={fullName}
                    onChange={event => { setFullName(event.target.value); setError('') }}
                    placeholder={t('enterFullName')}
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('mobileNumber')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={mobile}
                    onChange={event => { setMobile(event.target.value); setError('') }}
                    placeholder={t('enterMobileNumber')}
                    autoComplete="username"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('username')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={username}
                    onChange={event => { setUsername(event.target.value); setError('') }}
                    placeholder={t('enterUsername')}
                    autoComplete="username"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('emailAddress')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="email"
                    value={email}
                    onChange={event => { setEmail(event.target.value); setError('') }}
                    placeholder={t('requiredOnlyForEmailOtp')}
                    autoComplete="email"
                  />
                </label>

                <div className="mt-3">
                  <span className="text-xs font-semibold text-slate-500">{t('sendOtpThrough')}</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                    {[
                      ['whatsapp', 'WhatsApp'],
                      ['email', 'Email'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setOtpChannel(value); setError('') }}
                        className={cx(
                          'h-10 rounded-md text-sm font-bold',
                          otpChannel === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('password')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="password"
                    value={password}
                    onChange={event => { setPassword(event.target.value); setError('') }}
                    placeholder={t('minimumCharacters')}
                    autoComplete="new-password"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('confirmPassword')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="password"
                    value={confirmPassword}
                    onChange={event => { setConfirmPassword(event.target.value); setError('') }}
                    placeholder={t('confirmPassword')}
                    autoComplete="new-password"
                  />
                </label>

                {error && (
                  <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                  </div>
                )}

                <button type="submit" className="mt-5 flex h-11 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
                  {t('sendOtp')}
                </button>
              </Section>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <Section title={t('verifyOtp')} subtitle={otpChannel === 'email' ? t('enterEmailOtp') : `Enter temporary OTP 1234 sent by ${t('whatsapp')}.`}>
                <div className="grid grid-cols-4 gap-2">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      className="flex h-14 min-w-0 rounded-lg border border-sky-100 bg-slate-50 text-center text-xl font-bold outline-none focus:ring-2 focus:ring-sky-300"
                      inputMode="numeric"
                      value={digit}
                      onChange={event => { updateOtp(index, event.target.value); setError('') }}
                      aria-label={`OTP digit ${index + 1}`}
                      disabled={saving}
                    />
                  ))}
                </div>

                {error && (
                  <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={saving} className="mt-7 flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:opacity-60">
                  {saving ? t('creatingAccount') : t('verifyOtpCreate')}
                </button>
              </Section>
            </form>
          )}
        </main>
      </div>
    </div>
  )
}

function HomeScreen({ customerSession, onBook, onOrders, onProfile, onViewOrder, onEditOrder }) {
  const { t } = useI18n()
  const [profile, setProfile] = useState(null)
  const [latestOrder, setLatestOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadHome() {
      setLoading(true)
      setError('')

      if (!customerSession?.contact_id) {
        setProfile(null)
        setLatestOrder(null)
        setError('Customer profile is not linked to this login.')
        setLoading(false)
        return
      }

      const [profileResult, orderResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('id,first_name,last_name,company_name,mobile,whatsapp_number,email,credit_debit_allowed')
          .eq('id', customerSession.contact_id)
          .single(),
        supabase
          .from('delivery_orders')
          .select(`
            id,
            order_number,
            order_source,
            pickup_address,
            delivery_address,
            scheduled_date,
            scheduled_time_from,
            scheduled_time_to,
            order_details_text,
            status,
            delivery_status,
            payment_status,
            currency,
            total_amount,
            created_at,
            order_items (
              id,
              item_type,
              parcel_description,
              quantity,
              line_total,
              is_deleted
            )
          `)
          .eq('customer_id', customerSession.contact_id)
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      if (cancelled) return

      if (profileResult.error) {
        setError(profileResult.error.message)
        setLoading(false)
        return
      }
      if (orderResult.error) {
        setError(orderResult.error.message)
        setLoading(false)
        return
      }

      setProfile(profileResult.data)
      setLatestOrder(orderResult.data?.[0] ? mapCustomerOrder(orderResult.data[0]) : null)
      setLoading(false)
    }

    loadHome()
    return () => { cancelled = true }
  }, [customerSession])

  const displayName = customerName(profile) || customerSession?.first_name || t('customerAccount')

  return (
    <>
      <Header
        title={`Hi, ${displayName.split(' ')[0]}`}
        subtitle={CUSTOMER_MOBILE_MODULE}
        right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Bell className="h-5 w-5" /></button>}
      />
      <main className="space-y-5 px-5 py-6">
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-500">
            {t('loadingAccount')}
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        {!loading && profile && (
          <Section title={displayName} subtitle={profile.mobile || customerSession?.mobile || t('customerAccount')}>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-slate-50 p-3">
              <div>
                <p className="text-xs text-slate-500">{t('creditDebit')}</p>
                <p className="mt-1 text-sm font-semibold">{profile.credit_debit_allowed ? t('allowed') : t('notAllowed')}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('notifications')}</p>
                <p className="mt-1 text-sm font-semibold">{profile.email ? `${t('whatsapp')} + ${t('email')}` : t('whatsapp')}</p>
              </div>
            </div>
          </Section>
        )}

        <section className="grid grid-cols-2 gap-3">
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onBook}>
            <Package className="h-6 w-6 text-sky-600" />
            <p className="mt-4 text-sm font-bold">{t('bookDelivery')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('externalRequest')}</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100">
            <ShoppingBag className="h-6 w-6 text-emerald-600" />
            <p className="mt-4 text-sm font-bold">{t('shopProducts')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('futureModule')}</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onOrders}>
            <ClipboardList className="h-6 w-6 text-blue-600" />
            <p className="mt-4 text-sm font-bold">{t('myOrders')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('trackStatus')}</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onProfile}>
            <User className="h-6 w-6 text-cyan-600" />
            <p className="mt-4 text-sm font-bold">{t('profile')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('savedAddresses')}</p>
          </button>
        </section>

        <Section title={t('latestOrder')} subtitle={t('latestOrderSubtitle')}>
          {latestOrder ? (
            <OrderCard order={latestOrder} onView={() => onViewOrder(latestOrder)} onEdit={latestOrder.status === 'pending' ? () => onEditOrder(latestOrder) : undefined} />
          ) : (
            <div className="rounded-lg border border-sky-100 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-bold text-slate-950">{t('noOrdersYet')}</p>
              <button type="button" onClick={onBook} className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">
                {t('bookDelivery')}
              </button>
            </div>
          )}
        </Section>
      </main>
    </>
  )
}

function customerName(customer) {
  if (!customer) return ''
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer'
}

function addressText(address) {
  if (!address) return ''
  return [address.address_line, address.city].filter(Boolean).join(', ') || address.reference || address.address_name || ''
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value || 0)
  return `${currency || 'USD'} ${amount.toFixed(2)}`
}

function formatOrderSchedule(order) {
  const date = order.scheduled_date || order.created_at?.slice(0, 10) || ''
  const from = order.scheduled_time_from ? String(order.scheduled_time_from).slice(0, 5) : ''
  const to = order.scheduled_time_to ? String(order.scheduled_time_to).slice(0, 5) : ''
  if (date && from && to) return `${date}, ${from} - ${to}`
  if (date && from) return `${date}, ${from}`
  return date || 'Not scheduled'
}

function formatDateTime(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deliveryTimelineState(order, step) {
  const deliveryStatus = order.deliveryStatus || order.raw?.delivery_status || 'Awaiting Pickup'
  const sequence = ['Awaiting Pickup', 'Picked Up', 'In Transit', 'Delivered']
  const currentIndex = sequence.indexOf(deliveryStatus)
  const stepIndex = sequence.indexOf(step)
  if (order.status === 'cancelled' || order.status === 'failed') return 'Stopped'
  if (currentIndex > stepIndex) return 'Done'
  if (currentIndex === stepIndex) return 'Now'
  return 'Waiting'
}

function timelineTone(state) {
  if (state === 'Done') return 'text-emerald-600 bg-emerald-500'
  if (state === 'Now') return 'text-sky-600 bg-sky-500'
  if (state === 'Stopped') return 'text-rose-600 bg-rose-500'
  return 'text-slate-400 bg-slate-400'
}

function orderTypeLabel(order) {
  return order.order_source === 'external' || order.order_details_text ? 'Book Delivery' : 'Delivery Order'
}

function mapCustomerOrder(order, invoices = [], payments = []) {
  const activeItems = (order.order_items || []).filter(item => !item.is_deleted)
  const requirements = activeItems
    .map(item => item.parcel_description || item.item_type || 'Item')
    .filter(Boolean)
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_value || 0), 0)
  const invoiceCurrency = invoices[0]?.currency || order.currency || 'USD'
  const paidUsd = payments.reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0)
  const paidLbp = payments.reduce((sum, payment) => sum + Number(payment.amount_lbp || 0), 0)

  return {
    id: order.id,
    orderNumber: order.order_number,
    type: orderTypeLabel(order),
    status: order.status,
    deliveryStatus: order.delivery_status || 'Awaiting Pickup',
    paymentStatus: order.payment_status,
    pickup: order.pickup_address || '',
    drop: order.delivery_address || '',
    schedule: formatOrderSchedule(order),
    invoice: invoices.length
      ? `${invoices.length} invoice${invoices.length > 1 ? 's' : ''} / ${formatMoney(invoiceTotal, invoiceCurrency)}`
      : 'Waiting for quotation',
    payment: payments.length
      ? `Collected USD ${paidUsd.toFixed(2)}${paidLbp ? ` / LBP ${paidLbp.toFixed(0)}` : ''}`
      : order.payment_status || 'Unpaid',
    requirements: requirements.length ? requirements : (order.order_details_text ? order.order_details_text.split('\n').filter(Boolean) : []),
    raw: order,
    invoices,
    payments,
  }
}

function BookDeliveryScreen({ onSubmit, requirements, setRequirements, customerSession }) {
  const { t } = useI18n()
  const [customers, setCustomers] = useState([])
  const [addresses, setAddresses] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [pickupDate, setPickupDate] = useState(todayDate())
  const [pickupTime, setPickupTime] = useState('16:30')
  const [deliveryDate, setDeliveryDate] = useState(todayDate())
  const [deliveryTime, setDeliveryTime] = useState('18:00')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedOrder, setSavedOrder] = useState(null)

  const selectedCustomer = customers.find(customer => customer.id === customerId) || null

  useEffect(() => {
    let cancelled = false

    async function loadCustomers() {
      setLoading(true)
      setError('')

      let query = supabase
        .from('contacts')
        .select('*')
        .eq('contact_type', 'customer')
      if (customerSession?.contact_id) {
        query = query.eq('id', customerSession.contact_id)
      } else {
        query = query.order('created_at', { ascending: false }).limit(1)
      }
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data, error: customerError } = await query
      if (cancelled) return

      if (customerError) {
        setError(customerError.message)
        setLoading(false)
        return
      }

      const rows = data || []
      setCustomers(rows)
      if (rows.length > 0) setCustomerId(current => current || rows[0].id)
      setLoading(false)
    }

    loadCustomers()
    return () => { cancelled = true }
  }, [customerSession])

  useEffect(() => {
    if (!selectedCustomer) return

    setPickupAddress(current => current || selectedCustomer.default_pickup_address || selectedCustomer.address || '')
    setDeliveryAddress(current => current || selectedCustomer.default_delivery_address || selectedCustomer.address || '')

    let cancelled = false
    async function loadAddresses() {
      let query = supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', selectedCustomer.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data, error: addressError } = await query
      if (cancelled) return

      if (addressError) {
        setAddresses([])
        return
      }

      setAddresses(data || [])
      const primary = data?.find(address => address.is_primary) || data?.[0]
      const primaryText = addressText(primary)
      if (primaryText) {
        setPickupAddress(current => current || primaryText)
        setDeliveryAddress(current => current || primaryText)
      }
    }

    loadAddresses()
    return () => { cancelled = true }
  }, [selectedCustomer])

  function addRequirement() {
    setRequirements(items => [...items, ''])
  }

  function updateRequirement(index, value) {
    setRequirements(items => items.map((item, i) => (i === index ? value : item)))
  }

  function removeRequirement(index) {
    setRequirements(items => items.filter((_, i) => i !== index))
  }

  async function submitRequest() {
    setSaving(true)
    setError('')
    setSavedOrder(null)

    const customer = selectedCustomer
    const cleanRequirements = requirements.map(item => item.trim()).filter(Boolean)

    if (!customer) {
      setError(t('selectCustomer'))
      setSaving(false)
      return
    }
    if (cleanRequirements.length === 0) {
      setError('Add at least one requirement row.')
      setSaving(false)
      return
    }
    if (!pickupAddress.trim()) {
      setError(t('pickupLocationRequired'))
      setSaving(false)
      return
    }
    if (!deliveryAddress.trim()) {
      setError(t('deliveryLocationRequired'))
      setSaving(false)
      return
    }

    const customerDisplayName = customerName(customer)
    const orderDetailsText = cleanRequirements.join('\n')

    const orderPayload = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      customer_id: customer.id,
      pickup_address: pickupAddress.trim(),
      delivery_address: deliveryAddress.trim(),
      recipient_name: customerDisplayName,
      recipient_mobile: customer.mobile || customer.whatsapp_number || customer.whatsapp || 'not provided',
      recipient_whatsapp: customer.whatsapp_number || customer.whatsapp || customer.mobile || null,
      scheduled_date: deliveryDate || pickupDate || null,
      scheduled_time_from: pickupTime || null,
      scheduled_time_to: deliveryTime || null,
      order_details_text: orderDetailsText,
      special_instructions: notes.trim() || null,
      order_source: 'external',
      status: 'pending',
      payment_status: 'unpaid',
      driver_id: null,
      delivery_fee: 0,
      currency: 'USD',
      items_total: 0,
      total_amount: 0,
    }

    const { data: order, error: orderError } = await supabase
      .from('delivery_orders')
      .insert([orderPayload])
      .select('id, order_number')
      .single()

    if (orderError) {
      setError(orderError.message)
      setSaving(false)
      return
    }

    const itemRows = cleanRequirements.map(item => ({
      order_id: order.id,
      item_type: 'external_request',
      parcel_description: item,
      quantity: 1,
      unit_price: 0,
      currency: 'USD',
      discount: 0,
      line_total: 0,
    }))

    const { error: itemError } = await supabase.from('order_items').insert(itemRows)
    if (itemError) {
      setError(itemError.message)
      setSaving(false)
      return
    }

    setSavedOrder(order)
    setSaving(false)
    onSubmit?.(order)
  }

  return (
    <>
      <Header
        title={t('bookDelivery')}
        subtitle={t('tellUsNeed')}
      />
      <main className="space-y-4 px-5 pb-40 pt-5">
        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">{t('tellUsNeed')}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{t('addRequestLines')}</p>
            </div>
            <button type="button" onClick={addRequirement} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">
              {t('add')}
            </button>
          </div>
          <div className="space-y-3">
            {requirements.map((item, index) => (
              <div key={index} className="flex min-h-[3.4rem] items-center gap-2 rounded-lg border border-sky-100 bg-slate-50 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-950 outline-none placeholder:text-slate-400"
                  value={item}
                  onChange={event => updateRequirement(index, event.target.value)}
                  placeholder={t('typeCustomerRequirement')}
                />
                <button type="button" onClick={() => removeRequirement(index)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">{t('pickup')}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{t('pickupSubtitle')}</p>
            </div>
            <MapPin className="h-5 w-5 text-sky-600" />
          </div>
          <AddressQuickPick
            addresses={addresses}
            fallback={selectedCustomer?.default_pickup_address || selectedCustomer?.address}
            onSelect={setPickupAddress}
          />
          <ControlledField label={t('pickupLocation')} value={pickupAddress} onChange={setPickupAddress} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ControlledField label={t('pickupDate')} value={pickupDate} onChange={setPickupDate} type="date" />
            <ControlledField label={t('pickupTime')} value={pickupTime} onChange={setPickupTime} type="time" />
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">{t('deliveryDrop')}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{t('finalDeliveryLocation')}</p>
            </div>
            <Package className="h-5 w-5 text-emerald-600" />
          </div>
          <AddressQuickPick
            addresses={addresses}
            fallback={selectedCustomer?.default_delivery_address || selectedCustomer?.address}
            onSelect={setDeliveryAddress}
          />
          <ControlledField label={t('deliveryDropLocation')} value={deliveryAddress} onChange={setDeliveryAddress} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ControlledField label={t('deliveryDate')} value={deliveryDate} onChange={setDeliveryDate} type="date" />
            <ControlledField label={t('deliveryTime')} value={deliveryTime} onChange={setDeliveryTime} type="time" />
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">{t('notesIfNeeded')}</span>
            <textarea
              className="mt-2 min-h-20 w-full resize-none rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
              value={notes}
              onChange={event => setNotes(event.target.value)}
            />
          </label>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {savedOrder && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            Created real order {savedOrder.order_number || savedOrder.id}.
          </div>
        )}

        <div className="fixed bottom-[76px] left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-sky-100 bg-white/95 px-5 py-3 shadow-lg shadow-sky-100 backdrop-blur">
          <button type="button" onClick={submitRequest} disabled={saving || loading} className="flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            {saving ? t('submitting') : t('submitRequest')}
          </button>
        </div>
      </main>
    </>
  )
}

function AddressQuickPick({ addresses = [], fallback = '', onSelect }) {
  const { t } = useI18n()
  const options = [
    ...addresses.map(address => ({
      id: address.id,
      label: address.address_name || address.reference || t('saved'),
      value: addressText(address),
    })),
    ...(fallback ? [{ id: 'fallback', label: t('default'), value: fallback }] : []),
  ].filter(option => option.value)

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {options.map(option => (
        <button key={option.id} type="button" onClick={() => onSelect?.(option.value)} className="shrink-0 rounded-full border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
          {option.label}
        </button>
      ))}
      <button type="button" className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
        {t('typeNew')}
      </button>
    </div>
  )
}

function ControlledField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        className="mt-2 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  )
}

function Field({ label, value, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input type={type} className="mt-2 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-sky-300" defaultValue={value} />
    </label>
  )
}

function OrdersScreen({ customerSession, onView, onEdit, deliveryStatusByOrder }) {
  const { t } = useI18n()
  const deliveryFilters = ['all', 'Awaiting Pickup', 'Picked Up', 'In Transit', 'Delivered']
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const visibleOrders = useMemo(() => (
    orders.map(order => {
      const liveStatus = deliveryStatusByOrder?.[order.id]
      if (!liveStatus || liveStatus === order.deliveryStatus) return order
      return {
        ...order,
        deliveryStatus: liveStatus,
        raw: {
          ...(order.raw || {}),
          delivery_status: liveStatus,
        },
      }
    })
  ), [deliveryStatusByOrder, orders])

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase()
    return visibleOrders.filter(order => {
      const statusMatch = filter === 'all' || order.deliveryStatus === filter
      const textMatch = !text || order.orderNumber?.toLowerCase().includes(text) || order.drop?.toLowerCase().includes(text)
      return statusMatch && textMatch
    })
  }, [filter, search, visibleOrders])

  useEffect(() => {
    let cancelled = false

    async function loadOrders() {
      setLoading(true)
      setError('')

      if (!customerSession?.contact_id) {
        setOrders([])
        setError('Customer profile is not linked to this login.')
        setLoading(false)
        return
      }

      let orderQuery = supabase
        .from('delivery_orders')
        .select(`
          id,
          order_number,
          customer_id,
          order_source,
          pickup_address,
          delivery_address,
          scheduled_date,
          scheduled_time_from,
          scheduled_time_to,
          order_details_text,
          special_instructions,
          recipient_name,
          recipient_mobile,
          status,
          delivery_status,
          payment_status,
          currency,
          total_amount,
          delivery_fee,
          items_total,
          created_at,
          confirmed_at,
          delivered_at,
          order_items (
            id,
            item_type,
            parcel_description,
            quantity,
            line_total,
            is_deleted
          )
        `)
        .eq('customer_id', customerSession.contact_id)
        .order('created_at', { ascending: false })
      if (COMPANY_ID) orderQuery = orderQuery.eq('company_id', COMPANY_ID)

      const { data: orderRows, error: orderError } = await orderQuery
      if (cancelled) return

      if (orderError) {
        setOrders([])
        setError(orderError.message)
        setLoading(false)
        return
      }

      const ids = (orderRows || []).map(order => order.id)
      let invoicesByOrder = {}
      let paymentsByOrder = {}

      if (ids.length) {
        const [invoiceResult, paymentResult] = await Promise.all([
          supabase
            .from('retail_goods_invoices')
            .select('id, order_id, shop_name, invoice_reference, invoice_date, invoice_value, currency, paid')
            .in('order_id', ids),
          supabase
            .from('payment_collections')
            .select('id, order_id, collection_type, amount_usd, amount_lbp, collected_at')
            .in('order_id', ids),
        ])
        if (cancelled) return

        if (invoiceResult.error) {
          setError(invoiceResult.error.message)
        }
        if (paymentResult.error) {
          setError(paymentResult.error.message)
        }

        invoicesByOrder = (invoiceResult.data || []).reduce((acc, invoice) => {
          acc[invoice.order_id] = [...(acc[invoice.order_id] || []), invoice]
          return acc
        }, {})
        paymentsByOrder = (paymentResult.data || []).reduce((acc, payment) => {
          acc[payment.order_id] = [...(acc[payment.order_id] || []), payment]
          return acc
        }, {})
      }

      setOrders((orderRows || []).map(order => mapCustomerOrder(order, invoicesByOrder[order.id] || [], paymentsByOrder[order.id] || [])))
      setLoading(false)
    }

    loadOrders()
    return () => { cancelled = true }
  }, [customerSession])

  return (
    <>
      <Header title={t('myOrders')} subtitle={t('trackBookings')} right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Search className="h-5 w-5" /></button>} />
      <main className="space-y-5 px-5 py-6">
        <label className="flex h-12 items-center gap-3 rounded-full border border-sky-100 bg-sky-50 px-4 text-sm text-slate-500">
          <Search className="h-4 w-4 text-sky-600" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('searchOrderNumber')}
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {deliveryFilters.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cx('shrink-0 rounded-full px-4 py-2 text-xs font-bold capitalize', filter === item ? 'bg-sky-600 text-white' : 'border border-sky-100 bg-white text-slate-500')}
            >
              {item === 'all' ? t('all') : translatedStatus(t, item)}
            </button>
          ))}
        </div>
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            {t('loadingOrders')}
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center">
            <p className="text-sm font-bold text-slate-950">{t('noOrdersFound')}</p>
            <p className="mt-1 text-sm text-slate-500">{t('yourSubmittedRequests')}</p>
          </div>
        )}
        <div className="space-y-4">
          {filtered.map(order => <OrderCard key={order.id} order={order} onView={() => onView(order)} onEdit={() => onEdit(order)} />)}
        </div>
      </main>
    </>
  )
}

function OrderCard({ order, onView, onEdit }) {
  const { t } = useI18n()
  const editable = order.status === 'pending' && order.type === 'Book Delivery'
  return (
    <article className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/80">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-700">{order.type === 'Book Delivery' ? 'B' : 'S'}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">{order.orderNumber}</p>
            <p className="text-sm text-slate-500">{order.type === 'Book Delivery' ? t('bookDelivery') : t('deliveryOrder')}</p>
          </div>
        </div>
        <span className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.deliveryStatus))}>{translatedStatus(t, order.deliveryStatus)}</span>
      </div>
      <p className="mt-5 text-sm font-semibold text-slate-950">
        {order.pickup ? `${t('pickup')}: ${order.pickup} / ${t('drop')}: ${order.drop}` : `${t('deliveryOrder')}: ${order.drop}`}
      </p>
      <p className="mt-1 text-sm text-slate-500">{order.schedule}</p>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onView} className="rounded-lg bg-sky-100 px-5 py-2 text-sm font-bold text-sky-700">{t('view')}</button>
        {editable && <button type="button" onClick={onEdit} className="rounded-lg bg-emerald-100 px-5 py-2 text-sm font-bold text-emerald-700">{t('edit')}</button>}
      </div>
    </article>
  )
}

function OrderDetailsScreen({ order, onEdit, onBack }) {
  const { t } = useI18n()
  if (!order) {
    return (
      <>
        <Header title={t('orderDetails')} subtitle={t('noOrderSelected')} back onBack={onBack} />
        <main className="px-5 py-6">
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            {t('selectOrderFromOrders')}
          </div>
        </main>
      </>
    )
  }

  const timeline = [
    [t('awaitingPickup'), 'Awaiting Pickup'],
    ['Picked Up', 'Picked Up'],
    ['In Transit', 'In Transit'],
    [t('delivered'), 'Delivered'],
  ].map(([label, step]) => {
    const state = deliveryTimelineState(order, step)
    return [label, state, timelineTone(state)]
  })
  const raw = order.raw || {}
  const invoices = order.invoices || []
  const payments = order.payments || []

  return (
    <>
      <Header title={t('orderDetails')} subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{translatedStatus(t, order.status)}</span>} />
      <main className="space-y-5 px-5 py-6">
        <Section title={order.type === 'Book Delivery' ? t('bookDelivery') : t('deliveryOrder')} subtitle={raw.order_source === 'external' ? t('customerCreatedRequest') : t('deliveryOrder')}>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-slate-50 p-3">
            <div>
              <p className="text-xs text-slate-500">{t('pickup')}</p>
              <p className="mt-1 text-sm font-semibold">{order.pickup || t('notProvided')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('drop')}</p>
              <p className="mt-1 text-sm font-semibold">{order.drop || t('notProvided')}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-white p-3">
            <div>
              <p className="text-xs text-slate-500">{t('paymentStatus')}</p>
              <p className="mt-1 text-sm font-semibold capitalize">{translatedStatus(t, order.paymentStatus || 'unpaid')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('deliveryStatus')}</p>
              <p className="mt-1 text-sm font-semibold">{translatedStatus(t, order.deliveryStatus || 'Awaiting Pickup')}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
            <p className="text-xs text-slate-500">{t('totalAmount')}</p>
            <p className="mt-1 text-sm font-semibold">{formatMoney(raw.total_amount, raw.currency)}</p>
          </div>
          <div className="mt-3 space-y-2">
            <InfoLine label={t('created')} value={formatDateTime(raw.created_at)} />
            {raw.special_instructions && <InfoLine label={t('notes')} value={raw.special_instructions} />}
          </div>
        </Section>
        <Section title={t('schedule')}>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <CalendarClock className="h-5 w-5 text-sky-600" />
            {order.schedule}
          </div>
        </Section>
        <Section title={t('itemsRequirements')} subtitle="from order_items">
          <div className="space-y-2">
            {(raw.order_items || []).filter(item => !item.is_deleted).length > 0 ? (
              (raw.order_items || []).filter(item => !item.is_deleted).map((item, index) => (
                <div key={item.id || index} className="flex items-start gap-3 rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-950">{item.parcel_description || item.item_type || 'Item'}</p>
                    <p className="mt-1 text-xs text-slate-500">{t('qty')} {Number(item.quantity || 0).toFixed(0)} / {formatMoney(item.line_total, raw.currency)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm text-slate-500">{t('noItemRows')}</div>
            )}
          </div>
        </Section>
        <Section title={t('retailGoodsInvoices')} subtitle="retail_goods_invoices">
          <div className="space-y-3">
            {invoices.length > 0 ? invoices.map(invoice => (
              <div key={invoice.id} className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-950">{invoice.shop_name || t('invoice')}</p>
                    <p className="mt-1 text-xs text-slate-500">{invoice.invoice_reference || t('noReference')} / {invoice.invoice_date || t('noDate')}</p>
                  </div>
                  <span className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-bold', invoice.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700')}>
                    {invoice.paid ? 'Paid' : t('unpaid')}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{formatMoney(invoice.invoice_value, invoice.currency)}</p>
              </div>
            )) : (
              <InfoLine label={t('invoice')} value={t('waitingForQuotation')} />
            )}
          </div>
        </Section>
        <Section title={t('paymentCollections')} subtitle="payment_collections">
          <div className="space-y-3">
            {payments.length > 0 ? payments.map(payment => (
              <div key={payment.id} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-3">
                <p className="text-sm font-bold capitalize text-orange-800">{payment.collection_type || t('payment')}</p>
                <p className="mt-1 text-xs text-orange-700">{formatDateTime(payment.collected_at)}</p>
                <p className="mt-3 text-sm font-semibold text-slate-950">
                  USD {Number(payment.amount_usd || 0).toFixed(2)}
                  {Number(payment.amount_lbp || 0) > 0 ? ` / LBP ${Number(payment.amount_lbp).toFixed(0)}` : ''}
                </p>
              </div>
            )) : (
              <InfoLine label={t('collection')} value={t('noPaymentCollected')} tone="amber" />
            )}
          </div>
        </Section>
        <Section title={t('statusTimeline')}>
          <div className="space-y-4">
            {timeline.map(([label, state, classes]) => (
              <div key={label} className="flex items-center gap-3">
                <span className={cx('h-4 w-4 rounded-full', classes.split(' ')[1])} />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <span className={cx('text-xs font-semibold', classes.split(' ')[0])}>{translatedStatus(t, state)}</span>
              </div>
            ))}
          </div>
        </Section>
        {order.status === 'pending' && order.type === 'Book Delivery' && (
          <button type="button" onClick={() => onEdit(order)} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
            <Pencil className="h-4 w-4" />
            {t('editOrder')}
          </button>
        )}
      </main>
    </>
  )
}

function InfoLine({ label, value, tone }) {
  return (
    <div className={cx('rounded-lg border px-3 py-3', tone === 'amber' ? 'border-orange-200 bg-orange-50' : 'border-sky-100 bg-slate-50')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('mt-1 text-sm font-semibold', tone === 'amber' ? 'text-orange-700' : 'text-slate-950')}>{value}</p>
    </div>
  )
}

function EditOrderScreen({ order, requirements, setRequirements, customerSession, onSave, onBack }) {
  const { t } = useI18n()
  const raw = order?.raw || {}
  const [pickupAddress, setPickupAddress] = useState(raw.pickup_address || order?.pickup || '')
  const [deliveryAddress, setDeliveryAddress] = useState(raw.delivery_address || order?.drop || '')
  const [scheduledDate, setScheduledDate] = useState(raw.scheduled_date || todayDate())
  const [scheduledFrom, setScheduledFrom] = useState(raw.scheduled_time_from ? String(raw.scheduled_time_from).slice(0, 5) : '')
  const [scheduledTo, setScheduledTo] = useState(raw.scheduled_time_to ? String(raw.scheduled_time_to).slice(0, 5) : '')
  const [notes, setNotes] = useState(raw.special_instructions || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!order) return
    const current = order.raw || {}
    setPickupAddress(current.pickup_address || order.pickup || '')
    setDeliveryAddress(current.delivery_address || order.drop || '')
    setScheduledDate(current.scheduled_date || todayDate())
    setScheduledFrom(current.scheduled_time_from ? String(current.scheduled_time_from).slice(0, 5) : '')
    setScheduledTo(current.scheduled_time_to ? String(current.scheduled_time_to).slice(0, 5) : '')
    setNotes(current.special_instructions || '')
  }, [order])

  function addRequirement() {
    setRequirements(items => [...items, ''])
  }

  function updateRequirement(index, value) {
    setRequirements(items => items.map((item, i) => (i === index ? value : item)))
  }

  function removeRequirement(index) {
    setRequirements(items => items.filter((_, i) => i !== index))
  }

  async function saveChanges() {
    setError('')

    if (!order?.id) {
      setError(t('selectOrderFromOrders'))
      return
    }
    if (order.status !== 'pending') {
      setError('This order is already confirmed and cannot be edited.')
      return
    }

    const cleanRequirements = requirements.map(item => item.trim()).filter(Boolean)
    if (!deliveryAddress.trim()) {
      setError(t('deliveryLocationRequired'))
      return
    }
    if (cleanRequirements.length === 0) {
      setError('Add at least one requirement row.')
      return
    }

    setSaving(true)

    const { data: latest, error: latestError } = await supabase
      .from('delivery_orders')
      .select('status')
      .eq('id', order.id)
      .single()

    if (latestError) {
      setError(latestError.message)
      setSaving(false)
      return
    }
    if (latest?.status !== 'pending') {
      setError('This order is no longer pending. Please reopen My Orders.')
      setSaving(false)
      return
    }

    const orderDetailsText = cleanRequirements.join('\n')
    const updatePayload = {
      pickup_address: pickupAddress.trim() || null,
      delivery_address: deliveryAddress.trim(),
      scheduled_date: scheduledDate || null,
      scheduled_time_from: scheduledFrom || null,
      scheduled_time_to: scheduledTo || null,
      order_details_text: orderDetailsText,
      special_instructions: notes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    const { error: orderError } = await supabase
      .from('delivery_orders')
      .update(updatePayload)
      .eq('id', order.id)
      .eq('status', 'pending')

    if (orderError) {
      setError(orderError.message)
      setSaving(false)
      return
    }

    const { error: softDeleteError } = await supabase
      .from('order_items')
      .update({
        is_deleted: true,
        deleted_by: customerSession?.user_id || null,
        deleted_at: new Date().toISOString(),
      })
      .eq('order_id', order.id)
      .eq('is_deleted', false)

    if (softDeleteError) {
      setError(softDeleteError.message)
      setSaving(false)
      return
    }

    const itemRows = cleanRequirements.map(item => ({
      order_id: order.id,
      item_type: 'external_request',
      parcel_description: item,
      quantity: 1,
      unit_price: 0,
      currency: raw.currency || 'USD',
      line_total: 0,
      added_by: customerSession?.user_id || null,
    }))

    const { data: insertedItems, error: itemError } = await supabase
      .from('order_items')
      .insert(itemRows)
      .select('id,item_type,parcel_description,quantity,line_total,is_deleted')

    if (itemError) {
      setError(itemError.message)
      setSaving(false)
      return
    }

    const updatedRaw = {
      ...raw,
      ...updatePayload,
      status: 'pending',
      order_items: insertedItems || [],
    }
    onSave(mapCustomerOrder(updatedRaw, order.invoices || [], order.payments || []))
    setSaving(false)
  }

  if (!order) {
    return (
      <>
        <Header title={t('editOrder')} subtitle={t('noOrderSelected')} back onBack={onBack} />
        <main className="px-5 py-6">
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            {t('selectOrderFromOrders')}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header title={t('editOrder')} subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{translatedStatus(t, order.status)}</span>} />
      <main className="space-y-5 px-5 py-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Changes update the same order. No new order number.
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <Section
          title={t('requirementRows')}
          subtitle={t('savedBackToOrderItems')}
          action={<button type="button" onClick={addRequirement} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">{t('add')}</button>}
        >
          <div className="space-y-3">
            {requirements.map((item, index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg border border-sky-100 bg-slate-50 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={item} onChange={event => updateRequirement(index, event.target.value)} placeholder={t('enterRequirement')} />
                <button type="button" onClick={() => removeRequirement(index)} className="text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('pickupDrop')}>
          <div className="space-y-4">
            <ControlledField label={t('pickupLocation')} value={pickupAddress} onChange={setPickupAddress} />
            <ControlledField label={t('deliveryDropLocation')} value={deliveryAddress} onChange={setDeliveryAddress} />
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">{t('notes')}</span>
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
          </div>
        </Section>

        <Section title={t('schedule')}>
          <div className="grid grid-cols-2 gap-3">
            <ControlledField label={t('deliveryDate')} value={scheduledDate} onChange={setScheduledDate} type="date" />
            <ControlledField label={t('startTime')} value={scheduledFrom} onChange={setScheduledFrom} type="time" />
            <ControlledField label={t('endTime')} value={scheduledTo} onChange={setScheduledTo} type="time" />
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={saveChanges} disabled={saving || order.status !== 'pending'} className="flex h-12 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
            {saving ? t('saving') : t('saveChanges')}
          </button>
          <button type="button" onClick={onBack} disabled={saving} className="flex h-12 items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-500 disabled:opacity-60">
            {t('cancel')}
          </button>
        </div>
      </main>
    </>
  )
}

function ProfileScreen({ customerSession, onSessionUpdate, onLogout }) {
  const { language, setLanguage, t } = useI18n()
  const [profile, setProfile] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingAddress, setEditingAddress] = useState(null)
  const [addressForm, setAddressForm] = useState(emptyAddressForm)
  const [mobileInput, setMobileInput] = useState(customerSession?.mobile || '')

  async function loadProfile() {
    setLoading(true)
    setError('')

    if (!customerSession?.contact_id) {
      setProfile(null)
      setAddresses([])
      setError('Customer profile is not linked to this login.')
      setLoading(false)
      return
    }

    const [profileResult, addressResult] = await Promise.all([
      supabase
        .from('contacts')
        .select('id,code,account_number,first_name,last_name,mobile,whatsapp_number,email,address,city,credit_debit_allowed,profile_photo_url')
        .eq('id', customerSession.contact_id)
        .single(),
      supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', customerSession.contact_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    if (profileResult.error) {
      setError(profileResult.error.message)
      setLoading(false)
      return
    }
    if (addressResult.error) {
      setError(addressResult.error.message)
      setLoading(false)
      return
    }

    setProfile(profileResult.data)
    setMobileInput(profileResult.data?.mobile || customerSession?.mobile || '')
    setAddresses(addressResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadProfile()
  }, [customerSession])

  function startAddAddress() {
    setEditingAddress('new')
    setAddressForm(emptyAddressForm)
    setError('')
  }

  function startEditAddress(address) {
    setEditingAddress(address.id)
    setAddressForm({
      address_name: address.address_name || '',
      reference: address.reference || '',
      address_line: address.address_line || '',
      city: address.city || '',
      phone: address.phone || '',
      notes: address.notes || '',
      is_primary: !!address.is_primary,
    })
    setError('')
  }

  function addressField(key, value) {
    setAddressForm(current => ({ ...current, [key]: value }))
    setError('')
  }

  async function uploadProfilePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')

    if (!file.type.startsWith('image/')) {
      setError(t('selectImage'))
      return
    }
    if (file.size > 750 * 1024) {
      setError('Photo must be below 750 KB for now.')
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      setSaving(true)
      const photoUrl = String(reader.result || '')
      const { error: photoError } = await supabase
        .from('contacts')
        .update({ profile_photo_url: photoUrl, updated_at: new Date().toISOString() })
        .eq('id', customerSession.contact_id)

      if (photoError) {
        setError(photoError.message)
        setSaving(false)
        return
      }

      setProfile(current => current ? { ...current, profile_photo_url: photoUrl } : current)
      setSaving(false)
    }
    reader.readAsDataURL(file)
  }

  async function saveMobileChange() {
    setError('')
    if (!mobileInput.trim()) {
      setError(t('mobileNumberRequired'))
      return
    }

    setSaving(true)
    let { data, error: mobileError } = await supabase.rpc('customer_contact_update_mobile', {
      p_contact_id: customerSession.contact_id,
      p_mobile: mobileInput.trim(),
    })
    if (isMissingRpc(mobileError)) {
      const fallback = await supabase.rpc('customer_update_mobile', {
        p_user_id: customerSession.user_id,
        p_contact_id: customerSession.contact_id,
        p_mobile: mobileInput.trim(),
      })
      data = fallback.data
      mobileError = fallback.error
    }

    if (mobileError) {
      const message = mobileError.message || ''
      if (message.includes('MOBILE_ALREADY_EXISTS')) setError('This mobile number is already used by another customer.')
      else if (message.includes('MOBILE_REQUIRED')) setError(t('mobileNumberRequired'))
      else setError('Mobile number update failed. Please try again.')
      setSaving(false)
      return
    }

    const updatedMobile = data?.[0]?.mobile || mobileInput.trim()
    const nextSession = saveCustomerSession({
      ...customerSession,
      username: updatedMobile,
      mobile: updatedMobile,
    })
    onSessionUpdate(nextSession)
    setProfile(current => current ? { ...current, mobile: updatedMobile, whatsapp_number: updatedMobile } : current)
    setSaving(false)
  }

  async function saveAddress() {
    setError('')
    if (!customerSession?.contact_id) {
      setError('Customer profile is not linked to this login.')
      return
    }
    if (!addressForm.address_name.trim()) {
      setError('Address name is required.')
      return
    }
    if (!addressForm.address_line.trim()) {
      setError('Address line is required.')
      return
    }

    setSaving(true)

    if (addressForm.is_primary) {
      const { error: clearError } = await supabase
        .from('contact_addresses')
        .update({ is_primary: false, updated_by: customerSession.user_id || null })
        .eq('contact_id', customerSession.contact_id)
      if (clearError) {
        setError(clearError.message)
        setSaving(false)
        return
      }
    }

    const payload = {
      address_name: addressForm.address_name.trim(),
      reference: addressForm.reference.trim() || null,
      address_line: addressForm.address_line.trim(),
      city: addressForm.city.trim() || null,
      phone: addressForm.phone.trim() || null,
      notes: addressForm.notes.trim() || null,
      is_primary: !!addressForm.is_primary,
      is_active: true,
      updated_by: customerSession.user_id || null,
      updated_at: new Date().toISOString(),
    }

    const result = editingAddress === 'new'
      ? await supabase
          .from('contact_addresses')
          .insert([{
            contact_id: customerSession.contact_id,
            ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
            created_by: customerSession.user_id || null,
            ...payload,
          }])
      : await supabase
          .from('contact_addresses')
          .update(payload)
          .eq('id', editingAddress)
          .eq('contact_id', customerSession.contact_id)

    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }

    setEditingAddress(null)
    setAddressForm(emptyAddressForm)
    await loadProfile()
    setSaving(false)
  }

  async function setPrimaryAddress(address) {
    setSaving(true)
    setError('')
    const { error: clearError } = await supabase
      .from('contact_addresses')
      .update({ is_primary: false, updated_by: customerSession?.user_id || null })
      .eq('contact_id', customerSession.contact_id)
    if (clearError) {
      setError(clearError.message)
      setSaving(false)
      return
    }
    const { error: setErrorResult } = await supabase
      .from('contact_addresses')
      .update({ is_primary: true, updated_by: customerSession?.user_id || null, updated_at: new Date().toISOString() })
      .eq('id', address.id)
      .eq('contact_id', customerSession.contact_id)
    if (setErrorResult) setError(setErrorResult.message)
    await loadProfile()
    setSaving(false)
  }

  async function deleteAddress(address) {
    setSaving(true)
    setError('')
    const { error: deleteError } = await supabase
      .from('contact_addresses')
      .update({ is_active: false, updated_by: customerSession?.user_id || null, updated_at: new Date().toISOString() })
      .eq('id', address.id)
      .eq('contact_id', customerSession.contact_id)
    if (deleteError) setError(deleteError.message)
    await loadProfile()
    setSaving(false)
  }

  const profileName = profile ? customerName(profile) : customerSession?.first_name || 'Customer'

  function changeLanguage(nextLanguage) {
    const normalized = normalizeLanguage(nextLanguage)
    localStorage.setItem(CUSTOMER_LANGUAGE_KEY, normalized)
    setLanguage(normalized)
    const nextSession = saveCustomerSession({
      ...customerSession,
      language: normalized,
    })
    onSessionUpdate(nextSession)
  }

  return (
    <>
      <Header title={t('profile')} subtitle={t('profileSubtitle')} right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><User className="h-5 w-5" /></button>} />
      <main className="space-y-5 px-5 py-6">
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            {t('loadingProfile')}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {!loading && (
          <Section title={profileName} subtitle={profile?.code || profile?.account_number || t('customerAccount')}>
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-2xl font-bold text-sky-700">
              {profile?.profile_photo_url ? (
                <img src={profile.profile_photo_url} alt={profileName} className="h-full w-full object-cover" />
              ) : (
                profileName.slice(0, 1).toUpperCase()
              )}
            </div>
            <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white">
              <Upload className="h-4 w-4" />
              {t('photo')}
              <input type="file" accept="image/*" className="hidden" onChange={uploadProfilePhoto} disabled={saving} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold', profile?.credit_debit_allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {profile?.credit_debit_allowed ? t('creditDebitAllowed') : t('cashOnly')}
            </span>
          </div>
          <div className="mt-4 rounded-lg border border-sky-100 bg-slate-50 p-3">
            <p className="text-sm font-semibold">{t('mobile')} {profile?.mobile || customerSession?.mobile || t('notSet')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('whatsapp')} {profile?.whatsapp_number || profile?.mobile || t('notSet')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('email')} {profile?.email || t('notSet')}</p>
          </div>
          </Section>
        )}

        {!loading && (
          <Section title={t('mobileNumber')} subtitle={t('mobileSubtitle')}>
            <div className="space-y-3">
              <ControlledField label={t('mobileNumber')} value={mobileInput} onChange={setMobileInput} />
              <button type="button" onClick={saveMobileChange} disabled={saving || mobileInput.trim() === (profile?.mobile || '').trim()} className="flex h-11 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
                {saving ? t('saving') : t('updateMobileNumber')}
              </button>
            </div>
          </Section>
        )}

        {!loading && (
          <Section title={t('language')} subtitle={t('languageSubtitle')}>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 sm:grid-cols-4">
              {languageOptions.map(option => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => changeLanguage(option.code)}
                  className={cx(
                    'min-h-11 rounded-md px-2 text-sm font-bold transition',
                    language === option.code ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'
                  )}
                >
                  {option.nativeLabel}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{t('languageSaved')}</p>
          </Section>
        )}

        {editingAddress && (
          <Section title={editingAddress === 'new' ? t('addAddress') : t('editAddress')}>
            <div className="space-y-4">
              <ControlledField label={t('addressName')} value={addressForm.address_name} onChange={value => addressField('address_name', value)} />
              <ControlledField label={t('reference')} value={addressForm.reference} onChange={value => addressField('reference', value)} />
              <ControlledField label={t('addressLine')} value={addressForm.address_line} onChange={value => addressField('address_line', value)} />
              <div className="grid grid-cols-2 gap-3">
                <ControlledField label={t('city')} value={addressForm.city} onChange={value => addressField('city', value)} />
                <ControlledField label={t('phone')} value={addressForm.phone} onChange={value => addressField('phone', value)} />
              </div>
              <label className="flex items-center gap-3 rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm font-semibold">
                <input type="checkbox" checked={addressForm.is_primary} onChange={event => addressField('is_primary', event.target.checked)} />
                {t('primaryAddress')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={saveAddress} disabled={saving} className="flex h-11 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
                  {saving ? t('saving') : t('save')}
                </button>
                <button type="button" onClick={() => setEditingAddress(null)} disabled={saving} className="flex h-11 items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-500 disabled:opacity-60">
                  {t('cancel')}
                </button>
              </div>
            </div>
          </Section>
        )}

        <Section title={t('savedAddresses')} subtitle={t('savedAddressesSubtitle')} action={<button type="button" onClick={startAddAddress} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">{t('add')}</button>}>
          <div className="space-y-3">
            {addresses.length === 0 && (
              <div className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                {t('noSavedAddresses')}
              </div>
            )}
            {addresses.map(address => (
              <div key={address.id} className="rounded-lg border border-sky-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold">{address.address_name}</p>
                      <p className="mt-1 text-sm text-slate-500">{addressText(address) || t('noAddressLine')}</p>
                      {address.reference && <p className="mt-1 text-xs text-slate-400">{address.reference}</p>}
                    </div>
                  </div>
                  {address.is_primary && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">{t('primary')}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!address.is_primary && <button type="button" onClick={() => setPrimaryAddress(address)} disabled={saving} className="rounded-lg bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{t('setPrimary')}</button>}
                  <button type="button" onClick={() => startEditAddress(address)} disabled={saving} className="rounded-lg border border-sky-100 bg-white px-3 py-1 text-xs font-semibold text-slate-500">{t('edit')}</button>
                  <button type="button" onClick={() => deleteAddress(address)} disabled={saving} className="rounded-lg bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">{t('delete')}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('preferences')}>
          <InfoLine label={t('defaultPayment')} value={profile?.credit_debit_allowed ? t('creditDebitAllowed') : t('cashOnDelivery')} />
          <div className="mt-3">
            <InfoLine label={t('notifications')} value={profile?.email ? `${t('whatsapp')} + ${t('email')}` : t('whatsapp')} />
          </div>
        </Section>

        <button type="button" onClick={onLogout} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white text-sm font-bold text-rose-600">
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </button>
      </main>
    </>
  )
}

export default function CustomerMobileApp() {
  const initialRoute = customerRouteFromHash()
  const initialSession = loadCustomerSession()
  const devBypass = isDevelopmentBypass()
  const [customerSession, setCustomerSession] = useState(initialSession)
  const [isLoggedIn, setIsLoggedIn] = useState(!!initialSession || devBypass)
  const [screen, setScreen] = useState(initialRoute)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [requirements, setRequirements] = useState(initialRequirements)
  const [deliveryStatusByOrder, setDeliveryStatusByOrder] = useState({})
  const [deliveryNotice, setDeliveryNotice] = useState(null)
  const [googleAuthChecked, setGoogleAuthChecked] = useState(false)
  const [language, setLanguageState] = useState(() => normalizeLanguage(initialSession?.language || localStorage.getItem(CUSTOMER_LANGUAGE_KEY) || 'en'))
  const currentLanguage = normalizeLanguage(language)
  const currentLanguageOption = languageOptions.find(option => option.code === currentLanguage) || languageOptions[0]
  const i18nValue = useMemo(() => ({
    language: currentLanguage,
    dir: currentLanguageOption.dir,
    setLanguage: nextLanguage => {
      const normalized = normalizeLanguage(nextLanguage)
      localStorage.setItem(CUSTOMER_LANGUAGE_KEY, normalized)
      setLanguageState(normalized)
    },
    t: (key, values) => translate(currentLanguage, key, values),
  }), [currentLanguage, currentLanguageOption.dir])

  useEffect(() => {
    document.documentElement.lang = currentLanguage
    document.documentElement.dir = currentLanguageOption.dir
  }, [currentLanguage, currentLanguageOption.dir])

  useEffect(() => {
    let cancelled = false

    async function completeGoogleLogin() {
      if (isLoggedIn || googleAuthChecked || !COMPANY_ID) return
      setGoogleAuthChecked(true)

      const { data: authData, error: authError } = await supabase.auth.getSession()
      if (cancelled || authError || !authData?.session?.user?.email) return

      const googleUser = authData.session.user
      const fullName = googleUser.user_metadata?.full_name || googleUser.user_metadata?.name || googleUser.email
      let { data, error } = await supabase.rpc('customer_contact_login_with_google', {
        p_company_id: COMPANY_ID,
        p_email: googleUser.email,
        p_full_name: fullName,
      })
      if (isMissingRpc(error)) {
        const fallback = await supabase.rpc('customer_login_with_google', {
          p_company_id: COMPANY_ID,
          p_email: googleUser.email,
          p_full_name: fullName,
        })
        data = fallback.data
        error = fallback.error
      }
      if (cancelled || error) return

      const user = data?.[0]
      if (!user?.contact_id) return

      const session = saveCustomerSession({ ...user, language: currentLanguage })
      setCustomerSession(session)
      setIsLoggedIn(true)
      setScreen('home')
      setCustomerHash('home')
    }

    completeGoogleLogin()
    return () => { cancelled = true }
  }, [isLoggedIn, googleAuthChecked, currentLanguage])

  async function startGoogleLogin() {
    const redirectTo = `${window.location.origin}${window.location.pathname}#/customer/login`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    })
    if (error) {
      throw error
    }
  }

  useEffect(() => {
    if (!isLoggedIn || !customerSession?.contact_id) return undefined

    let cancelled = false

    function applyDeliveryStatusChange(updatedOrder) {
      const nextStatus = updatedOrder.delivery_status || 'Awaiting Pickup'

      setDeliveryStatusByOrder(current => {
        const previousStatus = current[updatedOrder.id]
        if (previousStatus !== nextStatus) {
          setDeliveryNotice({
            orderId: updatedOrder.id,
            orderNumber: updatedOrder.order_number,
            deliveryStatus: nextStatus,
          })
        }
        return { ...current, [updatedOrder.id]: nextStatus }
      })

      setSelectedOrder(current => {
        if (!current || current.id !== updatedOrder.id) return current
        return {
          ...current,
          deliveryStatus: nextStatus,
          status: updatedOrder.status || current.status,
          paymentStatus: updatedOrder.payment_status || current.paymentStatus,
          raw: {
            ...(current.raw || {}),
            ...updatedOrder,
          },
        }
      })
    }

    async function checkDeliveryStatuses({ notify }) {
      let query = supabase
        .from('delivery_orders')
        .select('id,order_number,status,delivery_status,payment_status')
        .eq('customer_id', customerSession.contact_id)
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data, error } = await query
      if (cancelled) return
      if (error) return

      if (!notify) {
        setDeliveryStatusByOrder((data || []).reduce((acc, order) => {
          acc[order.id] = order.delivery_status || 'Awaiting Pickup'
          return acc
        }, {}))
        return
      }

      ;(data || []).forEach(applyDeliveryStatusChange)
    }

    checkDeliveryStatuses({ notify: false })
    const statusPoll = window.setInterval(() => {
      checkDeliveryStatuses({ notify: true })
    }, 10000)

    const channel = supabase
      .channel(`customer-delivery-status-${customerSession.contact_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'delivery_orders',
          filter: `customer_id=eq.${customerSession.contact_id}`,
        },
        payload => {
          applyDeliveryStatusChange(payload.new)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      window.clearInterval(statusPoll)
      supabase.removeChannel(channel)
    }
  }, [isLoggedIn, customerSession])

  if (!isLoggedIn && screen === 'otp') {
    return (
      <I18nContext.Provider value={i18nValue}>
        <OtpScreen
          onDone={async customer => {
            if (!COMPANY_ID) throw new Error('Company is not configured for customer registration.')

            let { data, error } = await supabase.rpc('customer_contact_register_with_password', {
              p_company_id: COMPANY_ID,
              p_full_name: customer.full_name,
              p_mobile: customer.mobile,
              p_email: customer.email,
              p_username: customer.username,
              p_otp_channel: customer.otp_channel,
              p_password: customer.password,
            })
            if (isMissingRpc(error)) {
              const fallback = await supabase.rpc('customer_register_with_password', {
                p_company_id: COMPANY_ID,
                p_full_name: customer.full_name,
                p_mobile: customer.mobile,
                p_email: customer.email,
                p_otp_channel: customer.otp_channel,
                p_password: customer.password,
              })
              data = fallback.data
              error = fallback.error
            }

            if (error) {
              const message = error.message || ''
              if (message.includes('CUSTOMER_ALREADY_EXISTS')) {
                throw new Error('This customer already exists. Please login with the same email/mobile and password.')
              }
              if (message.includes('PASSWORD_TOO_SHORT')) {
                throw new Error(i18nValue.t('passwordTooShort'))
              }
              if (message.includes('COMPANY_REQUIRED')) {
                throw new Error('Company is not configured for customer registration.')
              }
              // Surface the real Postgres error so the failure can be diagnosed
              // (e.g. missing column / constraint), instead of a generic message.
              console.error('customer_contact_register_with_password failed:', error)
              const detail = [error.message, error.details, error.hint].filter(Boolean).join(' — ')
              throw new Error(detail || 'Customer registration failed. Please try again.')
            }

            const user = data?.[0]
            if (!user?.contact_id) throw new Error('Customer registration did not return a customer profile.')

            const session = saveCustomerSession({ ...user, language: currentLanguage })
            setCustomerSession(session)
            setIsLoggedIn(true)
            setScreen('home')
            setCustomerHash('home')
          }}
          onBack={() => setScreen('login')}
          onGoogleLogin={startGoogleLogin}
        />
      </I18nContext.Provider>
    )
  }

  if (!isLoggedIn) {
    return (
      <I18nContext.Provider value={i18nValue}>
        <LoginScreen onLogin={session => { const nextSession = saveCustomerSession({ ...session, language: currentLanguage }); setCustomerSession(nextSession); setIsLoggedIn(true); setScreen('home'); setCustomerHash('home') }} onOtp={() => setScreen('otp')} onGoogleLogin={startGoogleLogin} />
      </I18nContext.Provider>
    )
  }

  function goTab(tab) {
    setScreen(tab)
    setCustomerHash(tab)
  }

  function openOrder(order) {
    setSelectedOrder(order)
    setScreen('orderDetails')
  }

  function editOrder(order) {
    if (!order) return
    setSelectedOrder(order)
    setRequirements(order.requirements || initialRequirements)
    setScreen('editOrder')
  }

  function finishOrderEdit(updatedOrder) {
    setSelectedOrder(updatedOrder)
    setRequirements(updatedOrder.requirements || initialRequirements)
    setScreen('orderDetails')
  }

  async function logoutCustomer() {
    if (customerSession?.user_id) {
      try {
        await supabase.rpc('logout_user', { p_user_id: customerSession.user_id })
      } catch {
        // Local logout should still proceed even if audit logging is unavailable.
      }
    }
    clearCustomerSession()
    setCustomerSession(null)
    setIsLoggedIn(false)
    setSelectedOrder(null)
    setDeliveryNotice(null)
    setDeliveryStatusByOrder({})
    setScreen('login')
    setCustomerHash('login')
  }

  let content
  let activeTab = screen

  if (screen === 'book') {
    content = <BookDeliveryScreen requirements={requirements} setRequirements={setRequirements} customerSession={customerSession} />
  } else if (screen === 'orders') {
    content = <OrdersScreen customerSession={customerSession} onView={openOrder} onEdit={editOrder} deliveryStatusByOrder={deliveryStatusByOrder} />
  } else if (screen === 'orderDetails') {
    activeTab = 'orders'
    content = <OrderDetailsScreen order={selectedOrder} onEdit={editOrder} onBack={() => setScreen('orders')} />
  } else if (screen === 'editOrder') {
    activeTab = 'orders'
    content = <EditOrderScreen order={selectedOrder} requirements={requirements} setRequirements={setRequirements} customerSession={customerSession} onBack={() => setScreen('orderDetails')} onSave={finishOrderEdit} />
  } else if (screen === 'profile') {
    content = <ProfileScreen customerSession={customerSession} onSessionUpdate={setCustomerSession} onLogout={logoutCustomer} />
  } else {
    activeTab = 'home'
    content = (
      <HomeScreen
        customerSession={customerSession}
        onBook={() => setScreen('book')}
        onOrders={() => setScreen('orders')}
        onProfile={() => setScreen('profile')}
        onViewOrder={openOrder}
        onEditOrder={editOrder}
      />
    )
  }

  return (
    <I18nContext.Provider value={i18nValue}>
      <Shell activeTab={activeTab} onTab={goTab}>
        <DeliveryStatusNotice
          notice={deliveryNotice}
          onClose={() => setDeliveryNotice(null)}
          onOpenOrders={() => {
            setDeliveryNotice(null)
            setScreen('orders')
            setCustomerHash('orders')
          }}
        />
        {content}
      </Shell>
    </I18nContext.Provider>
  )
}
