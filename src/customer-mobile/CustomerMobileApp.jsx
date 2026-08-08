import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  Bike,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Boxes,
  Gift,
  Circle,
  Eye,
  Home,
  SlidersHorizontal,
  X,
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
  ShoppingCart,
  Store,
  Minus,
  Smartphone,
  Trash2,
  Truck,
  Upload,
  User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ideliverLoginLogo from '../assets/ideliver-logo-login.png'
import { formatMobile, MOBILE_PREFIX, isBlankMobile } from '../lib/phone'
import { reserveCartLine, releaseCartLine, convertReservationsToSales, summarise as summariseStock } from '../lib/shopStock'

const CUSTOMER_MOBILE_MODULE = 'iDeliver Customer Mobile'
const DEFAULT_COMPANY_ID = '0e7eae0e-9a0b-4408-8847-e03232c0a460'
const COMPANY_ID = String(import.meta.env.VITE_COMPANY_ID || DEFAULT_COMPANY_ID || '').trim() || null
const CUSTOMER_SESSION_KEY = 'ideliver_customer_mobile_session'
const CUSTOMER_LANGUAGE_KEY = 'ideliver_customer_mobile_language'

const languageOptions = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', dir: 'ltr' },
  { code: 'ro', label: 'Romanian', nativeLabel: 'Romana', dir: 'ltr' },
]

const translations = {
  en: {
    add: 'Add',
    addRequestLines: 'Ask a driver to pick you up or drop you somewhere, or to bring you something — one request per line. E.g. “Pick me up from home to the office” or “2 pizzas from a pizzeria”.',
    addressLine: 'Address line',
    addressName: 'Address name',
    addAddress: 'Add Address',
    viewItem: 'View item',
    shopItemLocked: 'From the shop — change the quantity or remove it',
    homeWelcome: '3asari3 fast delivery welcomes you',
    available: '{{count}} available',
    outOfStock: 'Out of stock',
    orderedCount: '{{count}} ordered',
    preparedOnRequest: 'Prepared on request',
    outOfStockNote: 'This item is out of stock at the moment and can’t be added to your cart.',
    onlyLeft: 'Only {{count}} left',
    color: 'Color',
    size: 'Size',
    quantity: 'Qty',
    chooseColor: 'Choose a color',
    chooseSize: 'Choose a size',
    selectOptions: 'Select size / color',
    colorsCount: '{{count}} colors',
    sizesCount: '{{count}} sizes',
    filters: 'Filters',
    filterByCategory: 'Filter by category',
    allCategories: 'All categories',
    uncategorized: 'Uncategorized',
    clearFilters: 'Clear',
    signupAddress: 'Address',
    signupCity: 'City',
    enterAddress: 'Building, street, area…',
    enterCity: 'City',
    addressRequired: 'Address is required — it becomes the default address for your orders.',
    all: 'All',
    allowed: 'Allowed',
    awaitingPickup: 'Awaiting Pickup',
    book: 'Book',
    bookDelivery: 'Book Delivery',
    bookRide: 'Request Driver',
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
    deliveryDate: 'Drop-off date',
    deliveryDrop: 'Drop-off',
    deliveryDropLocation: 'Drop-off location',
    deliveryLocationRequired: 'Delivery/drop location is required.',
    deliveryOrder: 'Delivery Order',
    deliveryStatus: 'Delivery status',
    deliveryStatusUpdated: 'Delivery status updated',
    deliveryTime: 'Drop-off time',
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
    externalRequest: 'Request a driver to transport you, your parcels, or your purchases safely and conveniently.',
    finalDeliveryLocation: 'Where the driver drops you or the goods off',
    firstTimeOtp: 'First-time customer? Register with OTP',
    firstTimeSetup: 'First-time customer setup',
    fullName: 'Full name',
    futureModule: 'Browse nearby shops, select your favorite products, and have them delivered to your door.',
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
    pickup: 'Start from',
    pickupDrop: 'Pickup & Drop',
    pickupDate: 'Start date',
    pickupLocation: 'Start from location',
    pickupLocationRequired: 'The start-from location is required.',
    pickupSubtitle: 'Where the driver starts — pick a saved address or type a new one',
    pickupTime: 'Start time',
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
    shopSubtitle: 'Browse products from nearby shops',
    noShopItems: 'No products available yet. Please check back soon.',
    addToCart: 'Add to cart',
    added: 'Added',
    viewCart: 'View cart',
    yourCart: 'Your Cart',
    emptyCart: 'Your cart is empty.',
    continueShopping: 'Continue shopping',
    checkout: 'Checkout',
    deliverTo: 'Deliver to',
    noAddressOnFile: 'No saved address — please add one in your profile.',
    paymentMethod: 'Payment method',
    cashOnDelivery: 'Cash on delivery — pay at the door',
    orderSummary: 'Order summary',
    total: 'Total',
    placeOrder: 'Place order',
    placingOrder: 'Placing order…',
    orderPlacedTitle: 'Order placed!',
    orderPlacedMsg: 'Your order has been received. Please pay cash when it arrives at your door.',
    viewMyOrders: 'View my orders',
    confirmedViewOnly: 'Confirmed by the call center — view only',
    startTime: 'Start time',
    statusTimeline: 'Status Timeline',
    submitRequest: 'Submit Request',
    submitting: 'Submitting...',
    tellUsNeed: 'Tell us what you need',
    temporaryOtp: 'Temporary development OTP is 1234.',
    totalAmount: 'Total amount',
    trackBookings: 'Track bookings, invoices and payments',
    trackStatus: 'Track status',
    typeCustomerRequirement: 'Write here what you need…',
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
    viewItem: 'عرض الصنف',
    shopItemLocked: 'من المتجر — يمكنك تغيير الكمية أو حذف الصنف',
    homeWelcome: 'عالسريع للتوصيل السريع يرحّب بك',
    available: 'متوفر {{count}}',
    outOfStock: 'غير متوفر',
    orderedCount: 'تم طلبه {{count}} مرة',
    preparedOnRequest: 'يُحضّر عند الطلب',
    outOfStockNote: 'هذا الصنف غير متوفر حاليًا ولا يمكن إضافته إلى السلة.',
    onlyLeft: 'بقي {{count}} فقط',
    color: 'اللون',
    size: 'المقاس',
    quantity: 'الكمية',
    chooseColor: 'اختر اللون',
    chooseSize: 'اختر المقاس',
    selectOptions: 'اختر المقاس / اللون',
    colorsCount: '{{count}} ألوان',
    sizesCount: '{{count}} مقاسات',
    filters: 'التصفية',
    filterByCategory: 'تصفية حسب الفئة',
    allCategories: 'كل الفئات',
    uncategorized: 'بدون فئة',
    clearFilters: 'مسح',
    signupAddress: 'العنوان',
    signupCity: 'المدينة',
    enterAddress: 'المبنى، الشارع، المنطقة…',
    enterCity: 'المدينة',
    addressRequired: 'العنوان مطلوب — سيكون العنوان الافتراضي لطلباتك.',
    addRequestLines: 'اطلب سائقًا ليقلّك أو يوصلك إلى مكان، أو ليحضر لك شيئًا — طلب واحد في كل سطر. مثلاً «خذني من المنزل إلى المكتب» أو «بيتزا من مطعم».',
    addressLine: 'سطر العنوان',
    addressName: 'اسم العنوان',
    all: 'الكل',
    allowed: 'مسموح',
    awaitingPickup: 'بانتظار الاستلام',
    book: 'حجز',
    bookDelivery: 'حجز توصيل',
    bookRide: 'اطلب سائق',
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
    deliveryDate: 'تاريخ النزول',
    deliveryDrop: 'مكان النزول',
    deliveryDropLocation: 'موقع النزول',
    deliveryLocationRequired: 'موقع التوصيل مطلوب.',
    deliveryOrder: 'طلب توصيل',
    deliveryStatus: 'حالة التوصيل',
    deliveryStatusUpdated: 'تم تحديث حالة التوصيل',
    deliveryTime: 'وقت النزول',
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
    externalRequest: 'اطلب سائقًا لنقلك أنت أو طرودك أو مشترياتك بأمان وراحة.',
    finalDeliveryLocation: 'أين ينزلك السائق أو يسلّم الطلب',
    firstTimeOtp: 'عميل جديد؟ سجل باستخدام OTP',
    firstTimeSetup: 'إعداد عميل جديد',
    fullName: 'الاسم الكامل',
    futureModule: 'تصفح المتاجر القريبة، اختر منتجاتك المفضلة، واحصل عليها إلى باب منزلك.',
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
    pickup: 'الانطلاق من',
    pickupDrop: 'الاستلام والتسليم',
    pickupDate: 'تاريخ الانطلاق',
    pickupLocation: 'موقع الانطلاق',
    pickupLocationRequired: 'موقع الانطلاق مطلوب.',
    pickupSubtitle: 'من أين ينطلق السائق — اختر عنوانًا محفوظًا أو اكتب عنوانًا جديدًا',
    pickupTime: 'وقت الانطلاق',
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
    shopSubtitle: 'تصفح المنتجات من المتاجر القريبة',
    noShopItems: 'لا توجد منتجات متاحة بعد. يرجى المراجعة لاحقًا.',
    addToCart: 'أضف إلى السلة',
    added: 'تمت الإضافة',
    viewCart: 'عرض السلة',
    yourCart: 'سلة التسوق',
    emptyCart: 'سلة التسوق فارغة.',
    continueShopping: 'متابعة التسوق',
    checkout: 'إتمام الطلب',
    deliverTo: 'التوصيل إلى',
    noAddressOnFile: 'لا يوجد عنوان محفوظ — يرجى إضافة عنوان في ملفك.',
    paymentMethod: 'طريقة الدفع',
    cashOnDelivery: 'الدفع عند الاستلام — ادفع عند الباب',
    orderSummary: 'ملخص الطلب',
    total: 'الإجمالي',
    placeOrder: 'تأكيد الطلب',
    placingOrder: 'جارٍ تأكيد الطلب…',
    orderPlacedTitle: 'تم تأكيد الطلب!',
    orderPlacedMsg: 'تم استلام طلبك. يرجى الدفع نقدًا عند وصوله إلى باب منزلك.',
    viewMyOrders: 'عرض طلباتي',
    confirmedViewOnly: 'تم تأكيده من مركز الاتصال — للعرض فقط',
    startTime: 'وقت البداية',
    statusTimeline: 'خط الحالة',
    submitRequest: 'إرسال الطلب',
    submitting: 'جاري الإرسال...',
    tellUsNeed: 'أخبرنا بما تحتاج',
    temporaryOtp: 'رمز OTP المؤقت هو 1234.',
    totalAmount: 'المبلغ الإجمالي',
    trackBookings: 'تتبع الحجوزات والفواتير والمدفوعات',
    trackStatus: 'تتبع الحالة',
    typeCustomerRequirement: 'اكتب هنا ما تحتاجه…',
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
  viewItem: 'Voir l’article',
  shopItemLocked: 'Depuis la boutique — modifiez la quantité ou supprimez',
  homeWelcome: '3asari3 fast delivery vous souhaite la bienvenue',
  typeCustomerRequirement: 'Écrivez ici ce dont vous avez besoin…',
  available: '{{count}} disponibles',
  outOfStock: 'Rupture de stock',
  orderedCount: '{{count}} commandés',
  preparedOnRequest: 'Préparé à la commande',
  outOfStockNote: 'Cet article est en rupture de stock et ne peut pas être ajouté au panier.',
  onlyLeft: 'Plus que {{count}}',
  color: 'Couleur',
  size: 'Taille',
  quantity: 'Qté',
  chooseColor: 'Choisissez une couleur',
  chooseSize: 'Choisissez une taille',
  selectOptions: 'Choisir taille / couleur',
  colorsCount: '{{count}} couleurs',
  sizesCount: '{{count}} tailles',
  filters: 'Filtres',
  filterByCategory: 'Filtrer par catégorie',
  allCategories: 'Toutes les catégories',
  uncategorized: 'Sans catégorie',
  clearFilters: 'Effacer',
  signupAddress: 'Adresse',
  signupCity: 'Ville',
  enterAddress: 'Immeuble, rue, quartier…',
  enterCity: 'Ville',
  addressRequired: 'L’adresse est obligatoire — elle devient l’adresse par défaut de vos commandes.',
  addRequestLines: 'Demandez un chauffeur pour vous prendre ou vous déposer quelque part, ou pour vous apporter quelque chose — une demande par ligne. Ex. « Venez me chercher à la maison pour le bureau » ou « 2 pizzas d’une pizzeria ».',
  all: 'Tous',
  allowed: 'Autorise',
  awaitingPickup: 'En attente de ramassage',
  book: 'Reserver',
  bookDelivery: 'Reserver une livraison',
  bookRide: 'Demander un chauffeur',
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
  externalRequest: 'Demandez un chauffeur pour vous transporter, vous, vos colis ou vos achats, en toute sécurité et simplicité.',
  firstTimeOtp: 'Nouveau client ? Inscription avec OTP',
  firstTimeSetup: 'Configuration nouveau client',
  fullName: 'Nom complet',
  futureModule: 'Parcourez les boutiques à proximité, choisissez vos produits préférés et faites-vous les livrer à domicile.',
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
  pickup: 'Départ de',
  pickupLocation: 'Lieu de départ',
  pickupDate: 'Date de départ',
  pickupTime: 'Heure de départ',
  pickupSubtitle: 'D’où part le chauffeur — adresse enregistrée ou nouvelle',
  deliveryDrop: 'Dépose',
  deliveryDropLocation: 'Lieu de dépose',
  deliveryDate: 'Date de dépose',
  deliveryTime: 'Heure de dépose',
  finalDeliveryLocation: 'Où le chauffeur vous dépose ou livre',
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
  shopSubtitle: 'Parcourez les produits des boutiques à proximité',
  noShopItems: 'Aucun produit disponible pour le moment. Revenez bientôt.',
  addToCart: 'Ajouter au panier',
  added: 'Ajouté',
  viewCart: 'Voir le panier',
  yourCart: 'Votre panier',
  emptyCart: 'Votre panier est vide.',
  continueShopping: 'Continuer les achats',
  checkout: 'Commander',
  deliverTo: 'Livrer à',
  noAddressOnFile: 'Aucune adresse enregistrée — ajoutez-en une dans votre profil.',
  paymentMethod: 'Mode de paiement',
  cashOnDelivery: 'Paiement à la livraison — payez à la porte',
  orderSummary: 'Récapitulatif',
  total: 'Total',
  placeOrder: 'Passer la commande',
  placingOrder: 'Commande en cours…',
  orderPlacedTitle: 'Commande passée !',
  orderPlacedMsg: 'Votre commande a été reçue. Payez en espèces à sa livraison à votre porte.',
  viewMyOrders: 'Voir mes commandes',
  confirmedViewOnly: 'Confirmée par le centre d’appels — lecture seule',
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
  viewItem: 'Vezi produsul',
  shopItemLocked: 'Din magazin — schimba cantitatea sau elimina',
  homeWelcome: '3asari3 fast delivery iti ureaza bun venit',
  typeCustomerRequirement: 'Scrie aici de ce ai nevoie…',
  available: '{{count}} disponibile',
  outOfStock: 'Stoc epuizat',
  orderedCount: '{{count}} comandate',
  preparedOnRequest: 'Preparat la comanda',
  outOfStockNote: 'Acest produs nu este disponibil momentan si nu poate fi adaugat in cos.',
  onlyLeft: 'Doar {{count}} ramase',
  color: 'Culoare',
  size: 'Marime',
  quantity: 'Cant.',
  chooseColor: 'Alege o culoare',
  chooseSize: 'Alege o marime',
  selectOptions: 'Alege marime / culoare',
  colorsCount: '{{count}} culori',
  sizesCount: '{{count}} marimi',
  filters: 'Filtre',
  filterByCategory: 'Filtreaza dupa categorie',
  allCategories: 'Toate categoriile',
  uncategorized: 'Fara categorie',
  clearFilters: 'Sterge',
  signupAddress: 'Adresa',
  signupCity: 'Oras',
  enterAddress: 'Bloc, strada, zona…',
  enterCity: 'Oras',
  addressRequired: 'Adresa este obligatorie — devine adresa implicita a comenzilor tale.',
  addRequestLines: 'Cere un sofer care sa te ia sau sa te duca undeva, ori sa iti aduca ceva — o cerere pe linie. Ex. „Ia-ma de acasa pana la birou” sau „2 pizza de la o pizzerie”.',
  all: 'Toate',
  allowed: 'Permis',
  awaitingPickup: 'In asteptarea ridicarii',
  book: 'Rezerva',
  bookDelivery: 'Rezerva livrare',
  bookRide: 'Solicită șofer',
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
  externalRequest: 'Solicită un șofer care să te transporte pe tine, coletele sau cumpărăturile tale în siguranță și comod.',
  firstTimeOtp: 'Client nou? Inregistrare cu OTP',
  firstTimeSetup: 'Configurare client nou',
  fullName: 'Nume complet',
  futureModule: 'Răsfoiește magazinele din apropiere, alege produsele preferate și primește-le la ușa ta.',
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
  pickup: 'Plecare din',
  pickupLocation: 'Locul de plecare',
  pickupDate: 'Data plecarii',
  pickupTime: 'Ora plecarii',
  pickupSubtitle: 'De unde pleaca soferul — alege o adresa salvata sau scrie una noua',
  deliveryDrop: 'Destinatie',
  deliveryDropLocation: 'Locul de destinatie',
  deliveryDate: 'Data sosirii',
  deliveryTime: 'Ora sosirii',
  finalDeliveryLocation: 'Unde te lasa soferul sau livreaza',
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
  shopSubtitle: 'Răsfoiește produsele din magazinele din apropiere',
  noShopItems: 'Niciun produs disponibil încă. Revino curând.',
  addToCart: 'Adaugă în coș',
  added: 'Adăugat',
  viewCart: 'Vezi coșul',
  yourCart: 'Coșul tău',
  emptyCart: 'Coșul tău este gol.',
  continueShopping: 'Continuă cumpărăturile',
  checkout: 'Finalizează comanda',
  deliverTo: 'Livrare la',
  noAddressOnFile: 'Nicio adresă salvată — adaugă una în profil.',
  paymentMethod: 'Metodă de plată',
  cashOnDelivery: 'Plată la livrare — plătești la ușă',
  orderSummary: 'Rezumatul comenzii',
  total: 'Total',
  placeOrder: 'Trimite comanda',
  placingOrder: 'Se trimite comanda…',
  orderPlacedTitle: 'Comandă plasată!',
  orderPlacedMsg: 'Comanda ta a fost primită. Plătește cash când ajunge la ușa ta.',
  viewMyOrders: 'Vezi comenzile mele',
  confirmedViewOnly: 'Confirmată de call center — doar vizualizare',
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

const initialRequirements = ['']

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

/* Decorative backdrop — parcels, boxes, bikes and carts of assorted sizes
   drifting and bobbing behind every screen. Purely visual: no pointer events,
   hidden from screen readers, and still for anyone who prefers reduced motion.

   Each entry sets its own size, tint and timing so nothing moves in lockstep. */
const BACKDROP_SHAPES = [
  // Big, slow anchors
  { Icon: Boxes,        cls: 'left-[-6%]  top-[8%]   h-28 w-28 animate-bg-sway',  tint: 'text-sky-900/[0.07]', style: { animationDuration: '13s' } },
  { Icon: Package,      cls: 'right-[-4%] top-[40%]  h-24 w-24 animate-bg-float', tint: 'text-sky-900/[0.07]', style: { animationDuration: '11s', animationDelay: '1.2s' } },
  { Icon: ShoppingBag,  cls: 'left-[-5%]  bottom-[6%] h-24 w-24 animate-bg-float', tint: 'text-sky-900/[0.06]', style: { animationDuration: '12s', animationDelay: '2.4s' } },
  // Mid-sized
  { Icon: Gift,         cls: 'right-[10%] top-[16%]  h-14 w-14 animate-bg-sway',  tint: 'text-sky-800/[0.09]', style: { animationDuration: '8s',  animationDelay: '0.5s' } },
  { Icon: Package,      cls: 'left-[16%]  top-[56%]  h-16 w-16 animate-bg-float', tint: 'text-sky-800/[0.08]', style: { animationDuration: '6.5s', animationDelay: '1.8s' } },
  { Icon: Boxes,        cls: 'right-[18%] bottom-[22%] h-16 w-16 animate-bg-sway', tint: 'text-sky-800/[0.08]', style: { animationDuration: '9.5s', animationDelay: '0.9s' } },
  { Icon: Store,        cls: 'left-[40%]  top-[30%]  h-12 w-12 animate-bg-float', tint: 'text-sky-800/[0.07]', style: { animationDuration: '10s', animationDelay: '3.1s' } },
  // Small confetti-ish bits
  { Icon: MapPin,       cls: 'left-[28%]  top-[80%]  h-9  w-9  animate-bg-float', tint: 'text-sky-700/[0.10]', style: { animationDuration: '5s',  animationDelay: '0.3s' } },
  { Icon: ShoppingBag,  cls: 'right-[32%] top-[6%]   h-8  w-8  animate-bg-sway',  tint: 'text-sky-700/[0.10]', style: { animationDuration: '5.5s', animationDelay: '2.2s' } },
  { Icon: Gift,         cls: 'left-[8%]   top-[34%]  h-7  w-7  animate-bg-float', tint: 'text-sky-700/[0.10]', style: { animationDuration: '4.5s', animationDelay: '1.5s' } },
  { Icon: Package,      cls: 'right-[6%]  bottom-[34%] h-8 w-8 animate-bg-sway',  tint: 'text-sky-700/[0.10]', style: { animationDuration: '6s',  animationDelay: '2.9s' } },
]

// Things that travel right across the screen — different heights, sizes, speeds.
const BACKDROP_TRAVELLERS = [
  { Icon: ShoppingCart, cls: 'top-[22%] h-16 w-16', tint: 'text-sky-900/[0.08]', style: { animationDuration: '22s' } },
  { Icon: Bike,         cls: 'top-[52%] h-12 w-12', tint: 'text-sky-800/[0.09]', style: { animationDuration: '31s', animationDelay: '6s' } },
  { Icon: Truck,        cls: 'top-[72%] h-20 w-20', tint: 'text-sky-900/[0.07]', style: { animationDuration: '40s', animationDelay: '14s' } },
  { Icon: ShoppingCart, cls: 'top-[90%] h-9  w-9',  tint: 'text-sky-700/[0.10]', style: { animationDuration: '17s', animationDelay: '3s' } },
]

function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {BACKDROP_SHAPES.map(({ Icon, cls, tint, style }, i) => (
        <Icon key={`s${i}`} style={style} className={`absolute ${tint} motion-reduce:animate-none ${cls}`} />
      ))}
      {BACKDROP_TRAVELLERS.map(({ Icon, cls, tint, style }, i) => (
        <Icon key={`t${i}`} style={style}
          className={`absolute animate-bg-drift motion-reduce:animate-none ${tint} ${cls}`} />
      ))}
    </div>
  )
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
    <div className="min-h-screen overflow-hidden bg-[#eaf8fb] text-[#071923]" dir={dir}>
      <div className="relative mx-auto flex min-h-screen w-full max-w-full md:max-w-md flex-col overflow-hidden bg-[#f8fdff] shadow-2xl shadow-cyan-950/10">
        <AppBackdrop />
        <div className="relative z-10 flex-1 overflow-y-auto pb-20">{children}</div>
        <nav className="fixed bottom-0 left-0 z-20 w-full max-w-full md:left-1/2 md:max-w-md md:-translate-x-1/2 border-t border-sky-100 bg-white/95 px-4 py-3 backdrop-blur">
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
    <header className="sticky top-0 z-10 rounded-b-[2rem] border-b border-sky-50 bg-white/95 px-5 pb-6 pt-5 shadow-[0_8px_24px_-6px_rgba(14,165,233,0.28)] backdrop-blur">
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

/* Header pinned to the top of the app column so it never scrolls away. The
   spacer below it reserves exactly the header's height (measured, so it stays
   right in any language or at any width). Screens that need extra pinned
   content — the shop's search bar — build their own fixed block instead. */
function FixedHeader(props) {
  const ref = useRef(null)
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  return (
    <>
      <div ref={ref} className="fixed left-0 top-0 z-30 w-full max-w-full md:left-1/2 md:max-w-md md:-translate-x-1/2">
        <Header {...props} />
      </div>
      <div aria-hidden style={{ height: h }} />
    </>
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
    return supabase.rpc('customer_contact_login', {
      p_login: login,
      p_password: secret,
    })
  }

  function loginMessage(loginError) {
    const msg = loginError?.message || ''
    if (msg.includes('INVALID_CREDENTIALS')) return t('invalidCredentials')
    if (msg.includes('ACCOUNT_LOCKED')) return 'Account locked. Please try again later.'
    if (msg.includes('ACCOUNT_SUSPENDED')) return 'This account is suspended. Please contact support.'
    if (msg.includes('customer_contact_login')) {
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
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-full px-2 sm:px-0 md:max-w-md items-center">
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
  // Mandatory at sign-up: it becomes the customer's default pickup/delivery
  // address on every new order.
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
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
    if (!address.trim()) {
      setError(t('addressRequired'))
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
        address: address.trim(),
        city: city.trim() || null,
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
      <div className="mx-auto min-h-dvh w-full max-w-full px-2 sm:px-0 md:max-w-md bg-[#f8fdff] pb-[max(1rem,env(safe-area-inset-bottom))]">
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
                    onFocus={() => { if (isBlankMobile(mobile)) setMobile(MOBILE_PREFIX) }}
                    onBlur={() => { if (isBlankMobile(mobile)) setMobile('') }}
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

                {/* Mandatory — saved on the customer profile and used as the
                    default pickup/delivery address for every new order. */}
                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('signupAddress')} *</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={address}
                    onChange={event => { setAddress(event.target.value); setError('') }}
                    placeholder={t('enterAddress')}
                    autoComplete="street-address"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">{t('addressRequired')}</span>
                </label>

                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-slate-500">{t('signupCity')}</span>
                  <input
                    className="mt-1.5 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={city}
                    onChange={event => { setCity(event.target.value); setError('') }}
                    placeholder={t('enterCity')}
                    autoComplete="address-level2"
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

/* Item photo gallery — swipe on touch, arrows on desktop, dots to jump.
   Scroll position is the source of truth, so a swipe and an arrow tap stay in
   step with the indicator. */
function ItemGallery({ images = [], alt = '' }) {
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)
  const many = images.length > 1

  function goTo(i) {
    const el = trackRef.current
    if (!el) return
    const next = Math.max(0, Math.min(images.length - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    setIndex(next)
  }

  function onScroll(e) {
    const el = e.currentTarget
    const i = Math.round(el.scrollLeft / (el.clientWidth || 1))
    setIndex(Math.max(0, Math.min(images.length - 1, i)))
  }

  return (
    <div className="relative overflow-hidden">
      {/* The photo itself, blurred and cropped to fill, sits behind the frame so
          portrait/landscape shots never leave empty bands. It follows the
          gallery as the customer slides. */}
      <div aria-hidden
        className="absolute inset-0 scale-125 bg-cover bg-center blur-[24px]"
        style={{ backgroundImage: `url("${images[index] ?? images[0]}")` }} />
      <div aria-hidden className="absolute inset-0 bg-white/25" />

      <div ref={trackRef} onScroll={onScroll}
        className="relative flex snap-x snap-mandatory overflow-x-auto scroll-smooth">
        {images.map((src, i) => (
          <img key={i} src={src} alt={`${alt} ${i + 1}`}
            className="h-56 w-full flex-shrink-0 snap-center object-contain" />
        ))}
      </div>

      {many && (<>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index === images.length - 1}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
          {images.map((_, i) => (
            <button key={i} type="button" onClick={() => goTo(i)} aria-label={`Photo ${i + 1}`}
              className={cx('h-1.5 rounded-full transition-all',
                i === index ? 'w-4 bg-sky-600' : 'w-1.5 bg-slate-950/25')} />
          ))}
        </div>
      </>)}
    </div>
  )
}

function ShopScreen({ onAdd, onOpenCart, cartCount = 0 }) {
  const { t } = useI18n()
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  // Category filter: [] = show everything, otherwise keep items in ANY of the
  // picked categories. Values are the raw `category` strings on the items
  // (Food, Grocery, Tools & Hardware…), with '' standing for uncategorized.
  const [catFilter,   setCatFilter]   = useState([])
  const [filterOpen,  setFilterOpen]  = useState(false)
  const [preview,     setPreview]     = useState(null)   // item shown in the popup
  const [stock,       setStock]       = useState({})     // itemId → { available, tracked }
  // Variant choices inside the popup (reset each time one is opened).
  const [pickedColor, setPickedColor] = useState('')
  const [pickedSize,  setPickedSize]  = useState('')
  const [pickedQty,   setPickedQty]   = useState(1)
  const [variantErr,  setVariantErr]  = useState('')

  // Open the item popup with a clean set of choices; a single colour/size is
  // preselected since there is nothing to decide.
  function openPreview(it) {
    const colors = itemColors(it)
    const sizes  = itemSizes(it)
    setPickedColor(colors.length === 1 ? colors[0].name : '')
    setPickedSize(sizes.length === 1 ? sizes[0] : '')
    setPickedQty(1)
    setVariantErr('')
    setPreview(it)
  }

  // The header + search bar are FIXED (not sticky) so no scroll container can
  // drag them along. Their height is measured so the list starts below them.
  const topRef = useRef(null)
  const [topH, setTopH] = useState(0)
  useEffect(() => {
    const el = topRef.current
    if (!el) return undefined
    const measure = () => setTopH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const OWNER = 'owner:contacts!owner_contact_id(id,company_name,first_name,last_name,partner_percentage,partner_percentage_type)'
      const run = cols => supabase
        .from('shop_inventory')
        .select(cols)
        .eq('is_displayed', true)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      let { data, error: e } = await run(`id,name,description,price,currency,image_url,images,category,categories,colors,sizes,is_made_to_order,owner_contact_id, ${OWNER}`)
      // `images` (fix105), `categories` (fix103) and `colors`/`sizes` (fix106)
      // are newer columns — on a DB where a migration hasn't run yet, fall back
      // so the shop still lists.
      if (e && /images|categories|colors|sizes|is_made_to_order/.test(e.message)) {
        ;({ data, error: e } = await run(`id,name,description,price,currency,image_url,category,owner_contact_id, ${OWNER}`))
      }
      if (cancelled) return
      if (e) { setError(e.message); setItems([]) }
      else { setItems(data || []); setError('') }
      setLoading(false)

      // Availability per item (fix113): on hand − what other carts hold.
      // Items with NO stock ledger at all are treated as untracked and stay
      // freely purchasable, so shops that don't count stock are unaffected.
      try {
        const ids = (data || []).map(i => i.id)
        if (ids.length === 0) return
        const [mv, rv] = await Promise.all([
          supabase.from('shop_inventory_movements').select('item_id,movement_type,quantity').in('item_id', ids),
          supabase.from('shop_reservations').select('item_id,quantity').in('item_id', ids)
            .gt('expires_at', new Date().toISOString()),
        ])
        if (cancelled || mv.error) return
        const map = summariseStock(mv.data ?? [], rv.data ?? [])
        // An item counts as stock-tracked only when its shop has recorded stock
        // MOVEMENTS for it. A cart reservation alone must never make an
        // untracked item look out of stock.
        const tracked = new Set((mv.data ?? []).map(m => m.item_id))
        const next = {}
        for (const id of ids) {
          const t = map.get(id)
          if (t) next[id] = { ...t, tracked: tracked.has(id) }
        }
        setStock(next)
      } catch { /* availability is a bonus — never break the shop over it */ }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const shopName = o => (o ? (o.company_name || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim() || 'Shop') : 'Shop')

  // Up to 3 photos per item (fix105); older rows only have `image_url`.
  const itemImages = it => {
    const list = Array.isArray(it.images) && it.images.length ? it.images : (it.image_url ? [it.image_url] : [])
    return list.filter(Boolean)
  }

  /* Availability (fix113). An item is only limited when its shop keeps a stock
     ledger; untracked items behave exactly as before. */
  const avail = it => stock[it?.id] ?? null
  // Food & co (fix114) are prepared on request: no stock, never sold out — the
  // customer sees how many have been ordered instead.
  const madeToOrder = it => !!it?.is_made_to_order
  const soldOut = it => {
    if (madeToOrder(it)) return false
    const a = avail(it)
    return !!a?.tracked && a.available <= 0
  }
  const orderedCount = it => avail(it)?.sold || 0

  // Variants (fix106) — optional colour/size lists on an item.
  const itemColors = it => (Array.isArray(it?.colors) ? it.colors.filter(c => c?.name) : [])
  const itemSizes  = it => (Array.isArray(it?.sizes)  ? it.sizes.filter(Boolean)       : [])

  // An item carries several category tags (fix103); rows saved before that
  // still have the single `category` string.
  const itemCats = it => {
    const list = Array.isArray(it.categories) && it.categories.length
      ? it.categories
      : (it.category ? [it.category] : [])
    const clean = list.map(c => String(c ?? '').trim()).filter(Boolean)
    return clean.length ? clean : ['']            // '' = uncategorized
  }

  // Category list built from what the shops actually stock, so it never offers
  // a category with nothing behind it. Case-insensitive de-dupe, with a count.
  const categories = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      for (const raw of itemCats(it)) {
        const key = raw.toLowerCase()
        const entry = map.get(key)
        if (entry) entry.count += 1
        else map.set(key, { value: raw, label: raw || t('uncategorized'), count: 1 })
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [items, t])

  const q = search.trim().toLowerCase()
  const catSet = new Set(catFilter.map(c => c.toLowerCase()))
  const filtered = items.filter(it =>
    (!q || it.name?.toLowerCase().includes(q)
        || itemCats(it).some(c => c.toLowerCase().includes(q))
        || shopName(it.owner).toLowerCase().includes(q))
    && (catSet.size === 0 || itemCats(it).some(c => catSet.has(c.toLowerCase()))))

  function toggleCategory(v) {
    setCatFilter(current => (current.includes(v) ? current.filter(x => x !== v) : [...current, v]))
  }

  // Build the cart line for whatever is selected in the popup. Items that offer
  // colours/sizes require a choice, so the order line is never ambiguous.
  function addPreviewToCart() {
    // Guard as well as disable the button — nothing out of stock gets in.
    if (soldOut(preview)) { setVariantErr(t('outOfStockNote')); return }
    const colors = itemColors(preview)
    const sizes  = itemSizes(preview)
    if (colors.length > 0 && !pickedColor) { setVariantErr(t('chooseColor')); return }
    if (sizes.length  > 0 && !pickedSize)  { setVariantErr(t('chooseSize'));  return }

    const variant = [pickedColor, pickedSize].filter(Boolean).join(' · ')
    onAdd?.({
      // One cart line per colour/size combination.
      id: [preview.id, pickedColor, pickedSize].filter(Boolean).join('::'),
      shop_item_id: preview.id,
      name: preview.name,
      variant_label: variant || null,
      color: pickedColor || null,
      size:  pickedSize  || null,
      qty: pickedQty,
      price: Number(preview.price) || 0,
      currency: preview.currency || 'USD',
      // Show the chosen colour's swatch in the cart when it has one.
      image_url: colors.find(c => c.name === pickedColor)?.image || itemImages(preview)[0] || preview.image_url,
      owner_contact_id: preview.owner_contact_id,
      shop: preview.shop,
      commission_percentage: preview.owner?.partner_percentage ?? null,
      partner_percentage_type: preview.owner?.partner_percentage_type ?? null,
    })
    setPreview(null)
  }

  const groups = {}
  for (const it of filtered) {
    const key = it.owner_contact_id || 'other'
    ;(groups[key] ||= { name: shopName(it.owner), items: [] }).items.push(it)
  }
  const groupList = Object.values(groups)
  const fmt = (v, c) => `${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c}`

  return (
    <>
      {/* Header + search stay pinned; the product list scrolls behind them.
          Constrained to the app column, like the bottom nav. */}
      <div ref={topRef}
        className="fixed left-0 top-0 z-30 w-full max-w-full md:left-1/2 md:max-w-md md:-translate-x-1/2">
        <Header title={t('shopProducts')} subtitle={t('shopSubtitle')}
          right={
            <button onClick={onOpenCart} className="relative flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white">{cartCount}</span>}
            </button>
          } />
        {/* Search + category filter. The filter button lives inside the search
            pill and pulls down a category menu underneath it. */}
        <div className="relative bg-[#f8fdff] px-5 pb-3 pt-4">
          <label className="flex h-12 items-center gap-3 rounded-full border border-sky-100 bg-sky-50 pl-4 pr-1.5 text-sm text-slate-500">
            <Search className="h-4 w-4 text-sky-600" />
            <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={search}
              onChange={e => setSearch(e.target.value)} placeholder={t('shopProducts')} />
            <button type="button" onClick={() => setFilterOpen(o => !o)}
              aria-label={t('filters')} title={t('filterByCategory')}
              className={cx(
                'relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                catFilter.length || filterOpen ? 'bg-sky-600 text-white' : 'bg-white text-sky-700 shadow-sm'
              )}>
              <SlidersHorizontal className="h-4 w-4" />
              {catFilter.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {catFilter.length}
                </span>
              )}
            </button>
          </label>

          {filterOpen && (<>
            <div className="fixed inset-0 z-20" onClick={() => setFilterOpen(false)} />
            <div className="absolute left-5 right-5 top-[4.25rem] z-30 max-h-72 overflow-y-auto rounded-2xl border border-sky-100 bg-white p-2 shadow-[0_12px_28px_-8px_rgba(14,165,233,0.35)]">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('filterByCategory')}</span>
                <button type="button" onClick={() => setFilterOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <button type="button" onClick={() => setCatFilter([])}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-sky-50">
                {catFilter.length === 0
                  ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-sky-600" />
                  : <Circle className="h-4 w-4 flex-shrink-0 text-slate-300" />}
                <span className="truncate font-semibold">{t('allCategories')}</span>
                <span className="ml-auto text-xs text-slate-400">{items.length}</span>
              </button>
              {categories.map(c => {
                const on = catFilter.includes(c.value)
                return (
                  <button key={c.value || '__none__'} type="button" onClick={() => toggleCategory(c.value)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-sky-50">
                    {on
                      ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-sky-600" />
                      : <Circle className="h-4 w-4 flex-shrink-0 text-slate-300" />}
                    <span className="truncate text-left capitalize">{c.label}</span>
                    <span className="ml-auto text-xs text-slate-400">{c.count}</span>
                  </button>
                )
              })}
              {categories.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-slate-400">{t('noShopItems')}</p>
              )}
            </div>
          </>)}
        </div>
      </div>

      <main className="space-y-5 px-5 pb-28 pt-4" style={{ paddingTop: topH ? topH + 16 : undefined }}>
        {/* Active category chips — quick way to see and drop a filter */}
        {catFilter.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {catFilter.map(v => (
              <button key={v || '__none__'} type="button" onClick={() => toggleCategory(v)}
                className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold capitalize text-sky-700">
                {v || t('uncategorized')} <X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" onClick={() => setCatFilter([])}
              className="text-xs font-semibold text-slate-500 underline">{t('clearFilters')}</button>
          </div>
        )}
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">…</div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>
        )}
        {!loading && !error && groupList.length === 0 && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-10 text-center">
            <ShoppingBag className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">{t('noShopItems')}</p>
          </div>
        )}
        {groupList.map((g, gi) => (
          <section key={gi} className="space-y-3">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-950">{g.name}</h3>
              <span className="text-xs text-slate-400">· {g.items.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {g.items.map(it => (
                <div key={it.id} className="overflow-hidden rounded-lg border border-sky-100 bg-white shadow-sm">
                  {/* Tapping the photo — or "View item" under it — opens the
                      full picture and description. */}
                  <button type="button" onClick={() => openPreview({ ...it, shop: g.name })} className="relative block w-full">
                    {itemImages(it)[0]
                      ? <img src={itemImages(it)[0]} alt={it.name} className="h-28 w-full object-cover" />
                      : <div className="flex h-28 w-full items-center justify-center bg-sky-50"><ShoppingBag className="h-7 w-7 text-sky-200" /></div>}
                    {itemImages(it).length > 1 && (
                      <span className="absolute bottom-1 right-1 rounded-full bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        1/{itemImages(it).length}
                      </span>
                    )}
                  </button>
                  <button type="button" onClick={() => openPreview({ ...it, shop: g.name })}
                    className="flex w-full items-center justify-center gap-1.5 border-y border-sky-100 bg-sky-50/60 py-1.5 text-[11px] font-bold text-sky-700">
                    <Eye className="h-3.5 w-3.5" /> {t('viewItem')}
                  </button>
                  <div className="p-3">
                    <p className="truncate text-sm font-bold text-slate-950">{it.name}</p>
                    {it.description && <p className="mt-0.5 truncate text-xs text-slate-500">{it.description}</p>}
                    {itemCats(it).filter(Boolean).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {itemCats(it).filter(Boolean).map(c => (
                          <span key={c} className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">{c}</span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-sm font-bold text-sky-700">{fmt(it.price, it.currency)}</p>

                    {/* Demand for made-to-order items, availability for stocked ones */}
                    {madeToOrder(it) ? (
                      orderedCount(it) > 0 && (
                        <p className="mt-1 text-[11px] font-semibold text-sky-700">
                          {t('orderedCount', { count: orderedCount(it) })}
                        </p>
                      )
                    ) : avail(it)?.tracked && (
                      soldOut(it) ? (
                        <p className="mt-1 text-[11px] font-bold text-rose-600">{t('outOfStock')}</p>
                      ) : (
                        <p className={`mt-1 text-[11px] font-semibold ${
                          avail(it).available <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {avail(it).available <= 3
                            ? t('onlyLeft', { count: avail(it).available })
                            : t('available', { count: avail(it).available })}
                        </p>
                      )
                    )}
                    {madeToOrder(it) && (
                      <p className="mt-0.5 text-[10px] text-slate-400">{t('preparedOnRequest')}</p>
                    )}

                    {/* Variants available — say so on the card, and show the
                        colour swatches so it's obvious a choice is needed. */}
                    {(itemColors(it).length > 0 || itemSizes(it).length > 0) && (
                      <div className="mt-1.5 space-y-1">
                        {itemColors(it).length > 0 && (
                          <div className="flex items-center gap-1">
                            {itemColors(it).slice(0, 4).map(c => (
                              c.image
                                ? <img key={c.name} src={c.image} alt={c.name} title={c.name}
                                    className="h-5 w-5 rounded-full border border-sky-100 object-cover" />
                                : <span key={c.name} title={c.name}
                                    className="flex h-5 w-5 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-[8px] font-bold uppercase text-sky-700">
                                    {c.name.slice(0, 1)}
                                  </span>
                            ))}
                            {itemColors(it).length > 4 && (
                              <span className="text-[10px] font-semibold text-slate-400">+{itemColors(it).length - 4}</span>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] font-semibold text-slate-500">
                          {[
                            itemColors(it).length > 0 ? t('colorsCount', { count: itemColors(it).length }) : null,
                            itemSizes(it).length  > 0 ? t('sizesCount',  { count: itemSizes(it).length })  : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    )}

                    <button type="button" disabled={soldOut(it)}
                      onClick={() => {
                        // Items with colours/sizes must be configured first, so
                        // the card's button opens the popup instead.
                        if (itemColors(it).length > 0 || itemSizes(it).length > 0) {
                          openPreview({ ...it, shop: g.name })
                          return
                        }
                        onAdd?.({ id: it.id, shop_item_id: it.id, name: it.name, qty: 1, price: Number(it.price) || 0, currency: it.currency || 'USD', image_url: itemImages(it)[0] || it.image_url, owner_contact_id: it.owner_contact_id, shop: g.name, commission_percentage: it.owner?.partner_percentage ?? null, partner_percentage_type: it.owner?.partner_percentage_type ?? null })
                      }}
                      className={cx('mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold',
                        soldOut(it) ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-sky-600 text-white hover:bg-sky-700')}>
                      {soldOut(it)
                        ? t('outOfStock')
                        : (itemColors(it).length > 0 || itemSizes(it).length > 0)
                          ? <><SlidersHorizontal className="h-3.5 w-3.5" /> {t('selectOptions')}</>
                          : <><Plus className="h-3.5 w-3.5" /> {t('addToCart')}</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
      {cartCount > 0 && (
        <button onClick={onOpenCart}
          className="fixed bottom-24 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-sky-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-sky-600/30">
          <ShoppingCart className="h-4 w-4" /> {t('viewCart')} · {cartCount}
        </button>
      )}

      {/* Item popup — 80% of the screen, photo on top, details below. */}
      {preview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}>
          <div className="flex h-[80vh] w-[80vw] max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-sky-100 px-4 py-3">
              <p className="truncate text-sm font-bold text-slate-950">{preview.name}</p>
              <button type="button" onClick={() => setPreview(null)} aria-label={t('close')}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Photo gallery — swipe, arrows or dots to move between photos. */}
              {itemImages(preview).length > 0 ? (
                <ItemGallery images={itemImages(preview)} alt={preview.name} />
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-sky-50"><ShoppingBag className="h-10 w-10 text-sky-200" /></div>
              )}
              <div className="space-y-3 p-4">
                {preview.shop && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <Store className="h-3.5 w-3.5" /> {preview.shop}
                  </p>
                )}
                {itemCats(preview).filter(Boolean).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {itemCats(preview).filter(Boolean).map(c => (
                      <span key={c} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">{c}</span>
                    ))}
                  </div>
                )}
                <p className="text-lg font-bold text-sky-700">{fmt(preview.price, preview.currency)}</p>
                {preview.description && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{preview.description}</p>
                )}

                {/* ── Colour swatches ─────────────────────────── */}
                {itemColors(preview).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-950">{t('color')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {itemColors(preview).map(c => {
                        const on = pickedColor === c.name
                        return (
                          <button key={c.name} type="button"
                            onClick={() => { setPickedColor(c.name); setVariantErr('') }}
                            className={cx('w-24 overflow-hidden rounded-lg border bg-white text-left transition-colors',
                              on ? 'border-sky-600 ring-2 ring-sky-200' : 'border-sky-100')}>
                            {c.image
                              ? <img src={c.image} alt={c.name} className="h-16 w-full object-cover" />
                              : <div className="flex h-16 w-full items-center justify-center bg-sky-50"><ShoppingBag className="h-5 w-5 text-sky-200" /></div>}
                            <span className="block px-1.5 py-1 text-[11px] font-semibold leading-tight text-slate-700">{c.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── Size chips ──────────────────────────────── */}
                {itemSizes(preview).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-950">{t('size')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {itemSizes(preview).map(s => {
                        const on = pickedSize === s
                        return (
                          <button key={s} type="button"
                            onClick={() => { setPickedSize(s); setVariantErr('') }}
                            className={cx('min-w-[3rem] rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                              on ? 'border-sky-600 bg-sky-600 text-white' : 'border-sky-200 bg-white text-slate-700')}>
                            {s}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── Quantity ────────────────────────────────── */}
                <div className="flex items-center gap-3">
                  <p className="text-xs font-bold text-slate-950">{t('quantity')}</p>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setPickedQty(q => Math.max(1, q - 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold">{pickedQty}</span>
                    {/* Never let the customer pick more than is available */}
                    <button type="button"
                      onClick={() => setPickedQty(q => Math.min(!madeToOrder(preview) && avail(preview)?.tracked ? avail(preview).available : 99, q + 1))}
                      disabled={!madeToOrder(preview) && avail(preview)?.tracked && pickedQty >= avail(preview).available}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700 disabled:opacity-40">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {madeToOrder(preview) && (
                  <p className="text-xs font-semibold text-sky-700">
                    {t('preparedOnRequest')}
                    {orderedCount(preview) > 0 ? ` · ${t('orderedCount', { count: orderedCount(preview) })}` : ''}
                  </p>
                )}

                {/* Out of stock — say so plainly; the add button is disabled */}
                {soldOut(preview) && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    {t('outOfStockNote')}
                  </p>
                )}
                {!madeToOrder(preview) && !soldOut(preview) && avail(preview)?.tracked && avail(preview).available <= 3 && (
                  <p className="text-xs font-semibold text-amber-600">{t('onlyLeft', { count: avail(preview).available })}</p>
                )}

                {variantErr && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{variantErr}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-sky-100 p-3">
              <button type="button" onClick={() => setPreview(null)}
                className="flex h-11 flex-1 items-center justify-center rounded-lg border border-sky-200 bg-white text-sm font-bold text-sky-700">
                {t('close')}
              </button>
              <button type="button" onClick={addPreviewToCart} disabled={soldOut(preview)}
                className={cx('flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold',
                  soldOut(preview) ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-sky-600 text-white hover:bg-sky-700')}>
                {soldOut(preview) ? t('outOfStock') : <><Plus className="h-4 w-4" /> {t('addToCart')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const cartRound2 = n => Math.round((Number(n) || 0) * 100) / 100
const cartFmt = (v, c) => `${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c}`
function cartTotalsByCurrency(cart) {
  const t = {}
  for (const it of cart) t[it.currency || 'USD'] = (t[it.currency || 'USD'] || 0) + (Number(it.price) || 0) * it.qty
  return t
}

function CartScreen({ cart, setCartQty, removeFromCart, onCheckout, onContinue }) {
  const { t } = useI18n()
  const totals = cartTotalsByCurrency(cart)
  return (
    <>
      <FixedHeader title={t('yourCart')} />
      <main className="space-y-4 px-5 py-6 pb-44">
        {cart.length === 0 ? (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-10 text-center">
            <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">{t('emptyCart')}</p>
            <button onClick={onContinue} className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">{t('continueShopping')}</button>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map(it => (
              <div key={it.id} className="flex items-center gap-3 rounded-lg border border-sky-100 bg-white p-3">
                {it.image_url
                  ? <img src={it.image_url} alt="" className="h-14 w-14 flex-shrink-0 rounded-md object-cover" />
                  : <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md bg-sky-50"><ShoppingBag className="h-5 w-5 text-sky-200" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-950">{it.name}</p>
                  {it.variant_label && (
                    <p className="truncate text-[11px] font-semibold text-sky-700">{it.variant_label}</p>
                  )}
                  {it.shop && <p className="truncate text-xs text-slate-500">{it.shop}</p>}
                  <p className="mt-0.5 text-sm font-bold text-sky-700">{cartFmt(it.price, it.currency)}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button onClick={() => setCartQty(it.id, it.qty - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700"><Minus className="h-4 w-4" /></button>
                  <span className="w-5 text-center text-sm font-bold">{it.qty}</span>
                  <button onClick={() => setCartQty(it.id, it.qty + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700"><Plus className="h-4 w-4" /></button>
                  <button onClick={() => removeFromCart(it.id)} className="ml-1 text-slate-400 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {/* Constrained to the app column (like the bottom nav) so it doesn't
          stretch to the screen edges on wide displays. */}
      {cart.length > 0 && (
        <div className="fixed bottom-16 left-0 z-20 w-full max-w-full rounded-t-2xl border-t border-sky-100 bg-white px-5 py-3 shadow-[0_-8px_24px_-6px_rgba(14,165,233,0.28)] md:left-1/2 md:max-w-md md:-translate-x-1/2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">{t('total')}</span>
            <span className="text-sm font-bold text-slate-950">{Object.entries(totals).map(([c, v]) => cartFmt(v, c)).join(' + ')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onContinue}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-sky-200 bg-white text-sm font-bold text-sky-700">
              <ShoppingBag className="h-4 w-4" /> {t('continueShopping')}
            </button>
            <button onClick={onCheckout}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-sky-600 text-sm font-bold text-white">
              <ShoppingCart className="h-4 w-4" /> {t('checkout')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function CheckoutScreen({ cart, customerSession, onPlaced, onGoOrders, onBack }) {
  const { t } = useI18n()
  const [customer, setCustomer] = useState(null)
  const [address, setAddress]   = useState('')
  const [notes, setNotes]       = useState('')
  const [placing, setPlacing]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!customerSession?.contact_id) return
      const { data } = await supabase.from('contacts')
        .select('id,first_name,last_name,company_name,mobile,whatsapp_number,address,city')
        .eq('id', customerSession.contact_id).single()
      if (cancelled || !data) return
      setCustomer(data)

      // "Deliver to" defaults to the profile's PRIMARY saved address (the same
      // one Book Delivery uses), falling back to the address on the contact
      // itself. The customer can still type over it.
      let query = supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', data.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)
      const { data: saved } = await query
      if (cancelled) return

      const primary = saved?.find(a => a.is_primary) || saved?.[0]
      setAddress(addressText(primary) || [data.address, data.city].filter(Boolean).join(', '))
    }
    load(); return () => { cancelled = true }
  }, [customerSession])

  const totals = cartTotalsByCurrency(cart)
  const primaryCurrency = cart[0]?.currency || 'USD'

  async function placeOrder() {
    if (!customer) { setError('Profile not loaded yet.'); return }
    if (!address.trim()) { setError(t('noAddressOnFile')); return }
    setPlacing(true); setError('')
    const lines = cart.map(it =>
      `${it.qty} × ${it.name}${it.variant_label ? ` (${it.variant_label})` : ''} — ${cartFmt(it.price, it.currency)}`)
    // Scheduled for today so it lands in the operator's daily list (which is filtered
    // by scheduled date). Without this the order is created but hidden from Today.
    const pad = n => String(n).padStart(2, '0')
    const now = new Date()
    const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
    const startAt = new Date(now.getTime() + 20 * 60 * 1000)   // pickup ~20 min from now
    const endAt   = new Date(now.getTime() + 60 * 60 * 1000)   // delivery ~1 hour from now
    const orderPayload = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      customer_id: customer.id,
      scheduled_date: todayLocal,
      scheduled_time_from: hm(startAt),
      scheduled_time_to: hm(endAt),
      delivery_address: address.trim(),
      recipient_name: customerName(customer),
      recipient_mobile: customer.mobile || customer.whatsapp_number || 'not provided',
      recipient_whatsapp: customer.whatsapp_number || customer.mobile || null,
      order_details_text: lines.join('\n'),
      special_instructions: [t('cashOnDelivery'), notes.trim()].filter(Boolean).join(' — '),
      order_source: 'customer application',
      status: 'pending',
      payment_status: 'unpaid',
      // Nobody has agreed to collect this yet — the call center's confirmation
      // moves it to 'Awaiting Pickup'.
      delivery_status: 'Pending',
      collection_from_customer: 'Money is due',
      driver_id: null,
      delivery_fee: 0,
      currency: primaryCurrency,
      items_total: cartRound2(totals[primaryCurrency] || 0),
      total_amount: cartRound2(totals[primaryCurrency] || 0),
    }
    const { data: order, error: e } = await supabase.from('delivery_orders').insert([orderPayload]).select('id, order_number').single()
    if (e) { setError(e.message); setPlacing(false); return }
    const itemRows = cart.map(it => {
      const lineTotal = cartRound2((Number(it.price) || 0) * it.qty)
      const pct = Number(it.commission_percentage) || 0
      return {
        order_id: order.id, item_type: 'external_request',
        parcel_description: it.variant_label ? `${it.name} (${it.variant_label})` : it.name,
        // The shop_inventory product this line came from. `it.id` is the cart
        // line key, which encodes the variant — the product id is separate.
        shop_item_id: it.shop_item_id || it.id,
        variant_color: it.color || null,
        variant_size:  it.size  || null,
        supplier_id: it.owner_contact_id || null,
        supplier_name: it.shop || null,
        commission_percentage: pct || null,
        partner_percentage_type: it.partner_percentage_type || null,
        commission_amount: pct ? cartRound2(lineTotal * pct / 100) : null,
        quantity: it.qty, unit_price: Number(it.price) || 0, currency: it.currency || 'USD',
        discount: 0, line_total: lineTotal,
      }
    })
    let ins = await supabase.from('order_items').insert(itemRows)
    // variant_color/variant_size arrive with fix106 — save without them rather
    // than losing the order if that migration hasn't run.
    if (ins.error && /variant_(color|size)/.test(ins.error.message)) {
      ins = await supabase.from('order_items').insert(
        itemRows.map(({ variant_color: _c, variant_size: _s, ...rest }) => rest))
    }
    // The held stock becomes a sale in the supplier's inventory (fix113).
    await convertReservationsToSales({
      customerId: customer.id, orderId: order.id, cart, companyId: COMPANY_ID,
    })
    setPlacing(false)
    setDone(order)
    onPlaced?.(order)   // clears the cart in the parent
  }

  if (done) {
    return (
      <>
        <FixedHeader title={t('checkout')} />
        <main className="space-y-4 px-5 py-10">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <p className="mt-3 text-base font-bold text-slate-950">{t('orderPlacedTitle')}</p>
            <p className="mt-1 text-sm text-slate-600">{t('orderPlacedMsg')}</p>
            {done.order_number && <p className="mt-2 font-mono text-sm text-emerald-700">{done.order_number}</p>}
            <button onClick={onGoOrders} className="mt-5 h-11 w-full rounded-lg bg-sky-600 text-sm font-bold text-white">{t('viewMyOrders')}</button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <FixedHeader title={t('checkout')} right={<button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><ArrowLeft className="h-5 w-5" /></button>} />
      <main className="space-y-4 px-5 py-6 pb-40">
        <section className="rounded-lg border border-sky-100 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('deliverTo')}</p>
          <textarea className="mt-2 w-full resize-none rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm outline-none" rows={2}
            value={address} onChange={e => setAddress(e.target.value)} placeholder={t('noAddressOnFile')} />
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('orderSummary')}</p>
          <div className="mt-2 space-y-2">
            {cart.map(it => (
              <div key={it.id} className="flex items-center justify-between text-sm">
                <span className="min-w-0 truncate text-slate-700">{it.qty} × {it.name}</span>
                <span className="ml-2 flex-shrink-0 font-semibold text-slate-950">{cartFmt((Number(it.price) || 0) * it.qty, it.currency)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-sky-100 pt-3">
            <span className="text-sm font-bold text-slate-500">{t('total')}</span>
            <span className="text-sm font-bold text-slate-950">{Object.entries(totals).map(([c, v]) => cartFmt(v, c)).join(' + ')}</span>
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('paymentMethod')}</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {t('cashOnDelivery')}
          </div>
          <textarea className="mt-3 w-full resize-none rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm outline-none" rows={2}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notes')} />
        </section>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
      </main>
      {cart.length > 0 && (
        <div className="fixed bottom-16 left-0 z-20 w-full max-w-full rounded-t-2xl border-t border-sky-100 bg-white px-5 py-3 shadow-[0_-8px_24px_-6px_rgba(14,165,233,0.28)] md:left-1/2 md:max-w-md md:-translate-x-1/2">
          <button onClick={placeOrder} disabled={placing}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
            {placing ? t('placingOrder') : t('placeOrder')}
          </button>
        </div>
      )}
    </>
  )
}

function HomeScreen({ customerSession, onBook, onOrders, onProfile, onShop, onViewOrder, onEditOrder }) {
  const { t } = useI18n()
  const [profile, setProfile] = useState(null)
  const [latestOrder, setLatestOrder] = useState(null)
  const [primaryAddress, setPrimaryAddress] = useState(null)

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
            order_confirmed,
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

      // The primary saved address — shown on the profile card in place of the
      // old credit/notifications tiles.
      let addrQ = supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', customerSession.contact_id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
      if (COMPANY_ID) addrQ = addrQ.eq('company_id', COMPANY_ID)
      const { data: saved } = await addrQ
      if (cancelled) return
      const primary = saved?.find(a => a.is_primary) || saved?.[0]
      setPrimaryAddress(primary || null)
    }

    loadHome()
    return () => { cancelled = true }
  }, [customerSession])

  const displayName = customerName(profile) || customerSession?.first_name || t('customerAccount')

  return (
    <>
      <FixedHeader
        title={`Hi, ${displayName.split(' ')[0]}`}
        subtitle={t('homeWelcome')}
        right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Bell className="h-5 w-5" /></button>}
      />
      <main className="space-y-5 px-5 pb-6 pt-4">
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
          <Section title={displayName} subtitle={formatMobile(profile.mobile || customerSession?.mobile) || t('customerAccount')}>
            <button type="button" onClick={onProfile}
              className="flex w-full items-start gap-2.5 rounded-lg border border-sky-100 bg-slate-50 p-3 text-left">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              <span className="min-w-0">
                <span className="block text-xs text-slate-500">{t('primaryAddress')}</span>
                <span className="mt-0.5 block text-sm font-semibold text-slate-950">
                  {addressText(primaryAddress) || t('noAddressOnFile')}
                </span>
                {primaryAddress?.address_name && (
                  <span className="mt-0.5 block text-[11px] text-slate-500">{primaryAddress.address_name}</span>
                )}
              </span>
            </button>
          </Section>
        )}

        <section className="grid grid-cols-2 gap-3">
          {/* Shop Products leads the grid, so it carries the app's blue. */}
          <button type="button" className="rounded-lg border border-sky-700 bg-sky-600 p-4 text-left shadow-sm shadow-sky-200" onClick={onShop}>
            <ShoppingBag className="h-6 w-6 text-white" />
            <p className="mt-4 text-sm font-bold text-white">{t('shopProducts')}</p>
            <p className="mt-1 text-xs text-sky-100">{t('futureModule')}</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onBook}>
            <Bike className="h-6 w-6 text-sky-600" />
            <p className="mt-4 text-sm font-bold">{t('bookRide')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('externalRequest')}</p>
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
            <OrderCard order={latestOrder} onView={() => onViewOrder(latestOrder)} onEdit={latestOrder.status === 'pending' && !latestOrder.confirmed ? () => onEditOrder(latestOrder) : undefined} />
          ) : (
            <div className="rounded-lg border border-sky-100 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-bold text-slate-950">{t('noOrdersYet')}</p>
              <button type="button" onClick={onBook} className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">
                {t('bookRide')}
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
  const paidUsd = payments.reduce((sum, p) => sum + ((p.currency || 'USD') === 'USD' ? Number(p.amount || 0) : 0), 0)
  const paidLbp = payments.reduce((sum, p) => sum + (p.currency === 'LBP' ? Number(p.amount || 0) : 0), 0)

  return {
    id: order.id,
    orderNumber: order.order_number,
    type: orderTypeLabel(order),
    status: order.status,
    confirmed: order.order_confirmed === true,   // confirmed by the call center → view-only
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

  function resetRequestForm() {
    const primaryAddress = addresses.find(address => address.is_primary) || addresses[0]
    const primaryAddressText = addressText(primaryAddress)

    setRequirements([...initialRequirements])
    setPickupAddress(primaryAddressText || selectedCustomer?.default_pickup_address || selectedCustomer?.address || '')
    setDeliveryAddress(primaryAddressText || selectedCustomer?.default_delivery_address || selectedCustomer?.address || '')
    setPickupDate(todayDate())
    setPickupTime('16:30')
    setDeliveryDate(todayDate())
    setDeliveryTime('18:00')
    setNotes('')
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
      order_source: 'customer application',
      status: 'pending',
      payment_status: 'unpaid',
      // Nobody has agreed to collect this yet — the call center's confirmation
      // moves it to 'Awaiting Pickup'.
      delivery_status: 'Pending',
      collection_from_customer: 'Money is due',
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

    resetRequestForm()
    setSavedOrder(order)
    setSaving(false)
    onSubmit?.(order)
  }

  return (
    <>
      <FixedHeader
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

        <div className="fixed bottom-[76px] left-0 z-20 w-full max-w-full px-5 py-3 shadow-lg shadow-sky-100 backdrop-blur md:left-1/2 md:max-w-md md:-translate-x-1/2 border-t border-sky-100 bg-white/95">
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
          order_confirmed,
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
            .select('id, order_id, shop_name, invoice_reference, invoice_date, invoice_value, currency, exclude_calculation')
            .in('order_id', ids),
          supabase
            .from('payment_collections')
            // Payment columns differ between deployed database versions. Select
            // the live row shape so an older schema cannot block My Orders.
            .select('*')
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
      <FixedHeader title={t('myOrders')} subtitle={t('trackBookings')} right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Search className="h-5 w-5" /></button>} />
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
  const editable = order.status === 'pending' && !order.confirmed && order.type === 'Book Delivery'
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
        <FixedHeader title={t('orderDetails')} subtitle={t('noOrderSelected')} back onBack={onBack} />
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
      <FixedHeader title={t('orderDetails')} subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{translatedStatus(t, order.status)}</span>} />
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
                  <span className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-bold', invoice.exclude_calculation ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700')}>
                    {invoice.exclude_calculation ? 'Paid' : t('unpaid')}
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
                  {(payment.currency || 'USD')} {Number(payment.amount || 0).toFixed((payment.currency === 'LBP') ? 0 : 2)}
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
        {order.status === 'pending' && !order.confirmed && order.type === 'Book Delivery' && (
          <button type="button" onClick={() => onEdit(order)} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
            <Pencil className="h-4 w-4" />
            {t('editOrder')}
          </button>
        )}
        {order.confirmed && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
            <Lock className="h-4 w-4" /> {t('confirmedViewOnly')}
          </div>
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
  // Lines that came from the Shop: the product is fixed, so only the quantity
  // can change and the whole line can be removed. Typed requirement rows stay
  // freely editable.
  const [shopLines, setShopLines] = useState([])

  useEffect(() => {
    let cancelled = false
    if (!order?.id) { setShopLines([]); return undefined }
    ;(async () => {
      const { data } = await supabase
        .from('order_items')
        .select('id,parcel_description,quantity,unit_price,currency,shop_item_id,supplier_name')
        .eq('order_id', order.id)
        .eq('is_deleted', false)
        .not('shop_item_id', 'is', null)
        .order('added_at')
      if (cancelled) return
      setShopLines((data ?? []).map(r => ({ ...r, quantity: Number(r.quantity) || 1 })))
    })()
    return () => { cancelled = true }
  }, [order?.id])

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
    if (order.confirmed) {
      setError(t('confirmedViewOnly'))
      return
    }

    const cleanRequirements = requirements.map(item => item.trim()).filter(Boolean)
    if (!deliveryAddress.trim()) {
      setError(t('deliveryLocationRequired'))
      return
    }
    // Deleting product/requirement rows is allowed — the order can be saved even
    // with none left (the items are just cleared).

    setSaving(true)

    const { data: latest, error: latestError } = await supabase
      .from('delivery_orders')
      .select('status, order_confirmed')
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
    if (latest?.order_confirmed === true) {
      setError(t('confirmedViewOnly'))
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

    // Only the typed requirement rows are replaced. Shop lines are updated in
    // place (quantity) or removed explicitly — they carry a price and a
    // supplier, so wiping them here would lose real money from the order.
    const { error: softDeleteError } = await supabase
      .from('order_items')
      .update({
        is_deleted: true,
        deleted_by: customerSession?.user_id || null,
        deleted_at: new Date().toISOString(),
      })
      .eq('order_id', order.id)
      .eq('is_deleted', false)
      .is('shop_item_id', null)

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

    let insertedItems = []
    if (itemRows.length) {
      const { data, error: itemError } = await supabase
        .from('order_items')
        .insert(itemRows)
        .select('id,item_type,parcel_description,quantity,line_total,is_deleted')
      if (itemError) {
        setError(itemError.message)
        setSaving(false)
        return
      }
      insertedItems = data || []
    }

    // Quantities the customer changed, and any line they removed.
    for (const line of shopLines) {
      if (line._removed) {
        await supabase.from('order_items').update({
          is_deleted: true,
          deleted_by: customerSession?.user_id || null,
          deleted_at: new Date().toISOString(),
        }).eq('id', line.id)
      } else {
        await supabase.from('order_items').update({
          quantity:   line.quantity,
          line_total: cartRound2((Number(line.unit_price) || 0) * line.quantity),
        }).eq('id', line.id)
      }
    }

    // Keep the order's money in step with what's left on it.
    const keptShop = shopLines.filter(l => !l._removed)
    const shopTotal = cartRound2(keptShop.reduce((n, l) => n + (Number(l.unit_price) || 0) * l.quantity, 0))
    await supabase.from('delivery_orders')
      .update({ items_total: shopTotal, total_amount: shopTotal })
      .eq('id', order.id)

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
        <FixedHeader title={t('editOrder')} subtitle={t('noOrderSelected')} back onBack={onBack} />
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
      <FixedHeader title={t('editOrder')} subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{translatedStatus(t, order.status)}</span>} />
      <main className="space-y-5 px-5 py-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Changes update the same order. No new order number.
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {shopLines.some(l => !l._removed) && (
          <Section title={t('shopProducts')} subtitle={t('shopItemLocked')}>
            <div className="space-y-3">
              {shopLines.map((line, index) => (line._removed ? null : (
                <div key={line.id} className="flex items-center gap-2 rounded-lg border border-sky-100 bg-slate-50 px-3 py-2">
                  <ShoppingBag className="h-4 w-4 shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1">
                    {/* Product name is fixed — it identifies what the shop sells. */}
                    <p className="truncate text-sm font-semibold text-slate-950">{line.parcel_description}</p>
                    <p className="text-[11px] text-slate-500">
                      {line.supplier_name ? `${line.supplier_name} · ` : ''}{cartFmt(line.unit_price, line.currency)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" aria-label="-"
                      onClick={() => setShopLines(ls => ls.map((l, i) => i === index ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l))}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{line.quantity}</span>
                    <button type="button" aria-label="+"
                      onClick={() => setShopLines(ls => ls.map((l, i) => i === index ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l))}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 text-sky-700">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setShopLines(ls => ls.map((l, i) => i === index ? { ...l, _removed: true } : l))}
                      className="ml-1 text-rose-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )))}
            </div>
          </Section>
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
          <button type="button" onClick={saveChanges} disabled={saving || order.status !== 'pending' || order.confirmed} className="flex h-12 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
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
    const { data, error: mobileError } = await supabase.rpc('customer_contact_update_mobile', {
      p_contact_id: customerSession.contact_id,
      p_mobile: mobileInput.trim(),
    })

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
      <FixedHeader title={t('profile')} subtitle={t('profileSubtitle')} right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><User className="h-5 w-5" /></button>} />
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
            <p className="text-sm font-semibold">{t('mobile')} {formatMobile(profile?.mobile || customerSession?.mobile) || t('notSet')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('whatsapp')} {formatMobile(profile?.whatsapp_number || profile?.mobile) || t('notSet')}</p>
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
  // Shopping cart (persisted). Each entry: { id, name, price, currency, image_url,
  // owner_contact_id, shop, qty }.
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ideliver:customerCart') || '[]') } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('ideliver:customerCart', JSON.stringify(cart)) } catch { /* ignore */ }
  }, [cart])
  const cartCount = cart.reduce((n, it) => n + (it.qty || 0), 0)
  // `id` is the cart LINE key — for items with variants it encodes the chosen
  // colour/size, so each combination is its own line.
  // Cart lines hold stock in the supplier's inventory (fix113): every change
  // here mirrors into shop_reservations so the shop owner sees what is
  // reserved. All best-effort — a failed reservation never blocks shopping.
  const holdLine = (line) => reserveCartLine({
    itemId: line.shop_item_id || line.id,
    ownerContactId: line.owner_contact_id,
    customerId: customerSession?.contact_id,
    cartLineKey: line.id,
    variantLabel: line.variant_label,
    quantity: line.qty,
    companyId: COMPANY_ID,
  })
  const dropLine = (id) => releaseCartLine({ customerId: customerSession?.contact_id, cartLineKey: id })

  const addToCart = (item) => setCart(prev => {
    const add = Math.max(1, Number(item.qty) || 1)
    const i = prev.findIndex(x => x.id === item.id)
    const next = i === -1
      ? [...prev, { ...item, qty: add }]
      : prev.map((x, j) => (j === i ? { ...x, qty: x.qty + add } : x))
    holdLine(next.find(x => x.id === item.id))
    return next
  })
  const setCartQty = (id, qty) => setCart(prev => {
    if (qty <= 0) { dropLine(id); return prev.filter(x => x.id !== id) }
    const next = prev.map(x => (x.id === id ? { ...x, qty } : x))
    holdLine(next.find(x => x.id === id))
    return next
  })
  const removeFromCart = (id) => { dropLine(id); setCart(prev => prev.filter(x => x.id !== id)) }
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
      const { data, error } = await supabase.rpc('customer_contact_login_with_google', {
        p_company_id: COMPANY_ID,
        p_email: googleUser.email,
        p_full_name: fullName,
      })
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

            const { data, error } = await supabase.rpc('customer_contact_register_with_password', {
              p_company_id: COMPANY_ID,
              p_full_name: customer.full_name,
              p_mobile: customer.mobile,
              p_email: customer.email,
              p_username: customer.username,
              p_otp_channel: customer.otp_channel,
              p_password: customer.password,
              // Mandatory address — stored on the contact and as their primary
              // saved address (supabase-fix102.sql).
              p_address: customer.address,
              p_city: customer.city,
            })

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
              if (message.includes('ADDRESS_REQUIRED')) {
                throw new Error(i18nValue.t('addressRequired'))
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
    // A confirmed (call-center) or non-pending order is view-only — open its details.
    if (order.confirmed || order.status !== 'pending') {
      setSelectedOrder(order)
      setScreen('orderDetails')
      return
    }
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
  } else if (screen === 'shop') {
    content = <ShopScreen onAdd={addToCart} onOpenCart={() => setScreen('cart')} cartCount={cartCount} />
  } else if (screen === 'cart') {
    content = <CartScreen cart={cart} setCartQty={setCartQty} removeFromCart={removeFromCart}
      onCheckout={() => setScreen('checkout')} onContinue={() => setScreen('shop')} />
  } else if (screen === 'checkout') {
    content = <CheckoutScreen cart={cart} customerSession={customerSession}
      onPlaced={() => setCart([])} onGoOrders={() => setScreen('orders')} onBack={() => setScreen('cart')} />
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
        onShop={() => setScreen('shop')}
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
