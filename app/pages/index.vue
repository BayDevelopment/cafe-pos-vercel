<!-- app/pages/index.vue -->
<template>
  <div class="stage min-h-screen relative overflow-x-hidden">
    <!-- TOAST ALERT -->
    <Transition name="slide-fade">
      <div
        v-if="showAlert"
        class="fixed top-3 right-3 sm:top-5 sm:right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border mono text-xs max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-2.5rem)]"
        :class="
          alertType === 'success'
            ? 'bg-[#2b1b12] text-[#faf6ee] border-[#b8763c]'
            : 'bg-[#9b3a2e] text-[#faf6ee] border-[#7a2e24]'
        "
      >
        <span class="text-base leading-none">{{
          alertType === "success" ? "✅" : "⚠️"
        }}</span>
        <p class="font-medium">{{ alertMessage }}</p>
      </div>
    </Transition>

    <div
      class="absolute -top-32 -left-24 w-64 h-64 sm:w-[26rem] sm:h-[26rem] rounded-full pointer-events-none glow"
    ></div>
    <div
      class="absolute -bottom-32 -right-24 w-64 h-64 sm:w-[26rem] sm:h-[26rem] rounded-full pointer-events-none glow"
    ></div>

    <div class="relative z-10 max-w-7xl mx-auto p-4 sm:p-5 md:p-8 lg:p-12 space-y-6 sm:space-y-8">
      <!-- HEADER UTAMA -->
      <div class="ticket-wrap">
        <div class="spike-hole" aria-hidden="true"></div>
        <div class="ticket p-5 sm:p-6 md:p-8">
          <div
            class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-5"
          >
            <div>
              <div class="flex items-center gap-2 mb-3 flex-wrap">
                <span
                  class="mono label-xs px-2.5 py-1 rounded-full bg-[#b8763c] text-[#faf6ee]"
                  >Guest Menu</span
                >
                <span class="mono label-xs text-[#8A7A68]">{{ today }}</span>
              </div>
              <div class="flex items-center gap-2.5">
                <svg
                  width="26"
                  height="26"
                  class="sm:w-[28px] sm:h-[28px] shrink-0"
                  viewBox="0 0 34 34"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6 13h18v7a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7v-7Z"
                    stroke="#B8763C"
                    stroke-width="1.6"
                  />
                  <path
                    d="M24 15h2.5a3.5 3.5 0 0 1 0 7H24"
                    stroke="#B8763C"
                    stroke-width="1.6"
                  />
                  <path
                    d="M4 27h22"
                    stroke="#B8763C"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                </svg>
                <h1
                  class="display text-xl sm:text-2xl md:text-3xl font-bold text-[#2b1b12] tracking-tight"
                >
                  KEDAI KOPI
                </h1>
              </div>
              <p class="mono text-xs text-[#8A7A68] mt-2">
                Pilih menu, tambahkan ke keranjang, lalu kirim pesanan ke kasir
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- STICKY SEARCH & CATEGORY NAVBAR -->
      <div
        class="sticky top-0 z-30 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 sm:py-3.5 bg-[#1c1410]/90 backdrop-blur-md border-y border-[#2b1b12]/60 shadow-xl transition-all"
      >
        <div class="max-w-7xl mx-auto space-y-2.5 sm:space-y-3">
          <input
            v-model="query"
            type="text"
            placeholder="Cari menu, misal: kopi susu, croissant…"
            class="field w-full"
            aria-label="Cari menu"
          />

          <!-- FILTER KATEGORI -->
          <div
            class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar md:flex-wrap md:overflow-visible"
          >
            <button
              type="button"
              class="category-pill mono shrink-0"
              :class="{ 'category-pill--active': selectedCategory === null }"
              @click="selectCategory(null)"
            >
              Semua
            </button>
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              class="category-pill mono shrink-0"
              :class="{ 'category-pill--active': selectedCategory === cat.id }"
              @click="selectCategory(cat.id)"
            >
              {{ cat.name }}
            </button>
          </div>
        </div>
      </div>

      <!-- LAYOUT: KATALOG (KIRI) + KERANJANG (KANAN) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 items-start">
        <!-- KATALOG PRODUK -->
        <div class="lg:col-span-2 space-y-7 sm:space-y-8">
          <!-- SKELETON LOADER (RESPONSIVE) -->
          <div
            v-if="pending"
            class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-5"
          >
            <div
              v-for="n in 6"
              :key="n"
              class="ticket-card p-4 sm:p-5 skeleton-card"
              aria-hidden="true"
            >
              <div class="skeleton-line w-2/3 h-4 mb-3"></div>
              <div class="skeleton-line w-1/3 h-3 mb-5"></div>
              <div class="skeleton-line w-1/2 h-5"></div>
            </div>
          </div>

          <!-- ERROR STATE -->
          <div v-else-if="error" class="ticket-card p-8 sm:p-10 text-center">
            <p class="mono text-xs text-[#9b3a2e]">
              Gagal memuat menu. Silakan muat ulang halaman.
            </p>
          </div>

          <!-- PRODUCT LIST -->
          <div v-else class="space-y-4">
            <div
              v-if="filteredProducts.length === 0"
              class="ticket-card p-8 sm:p-10 md:p-12 text-center"
            >
              <p class="mono text-xs text-[#8A7A68]">
                {{
                  query
                    ? `Tidak ada menu yang cocok dengan "${query}".`
                    : "Tidak ada produk di kategori ini."
                }}
              </p>
            </div>

            <div v-else class="flex items-center gap-3">
              <span class="mono label-xs text-[#8A7A68]"
                >{{ filteredProducts.length }} menu tersedia</span
              >
            </div>

            <!-- GRID PRODUK GABUNGAN (SEMUA KATEGORI JADI SATU GRID)
                 HP kecil: 1 kolom
                 HP besar / phablet & tablet: 2 kolom
                 Laptop kecil / tablet lanskap (lg, saat sidebar tampil): 2 kolom
                 Desktop/PC (xl ke atas): 3 kolom -->
            <div
              v-if="filteredProducts.length > 0"
              class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-5"
            >
              <div
                v-for="product in filteredProducts"
                :key="product.id"
                class="ticket-card overflow-hidden flex flex-col relative"
                :class="{ 'opacity-60 grayscale-[0.4]': product.stock <= 0 }"
              >
                <!-- BADGE DISKON -->
                <div
                  v-if="getDiscountPercent(product) > 0 && product.stock > 0"
                  class="absolute top-2 left-2 z-10 mono label-xs px-2 py-0.5 rounded-full bg-[#9b3a2e] text-[#faf6ee] shadow font-bold tracking-wider"
                >
                  {{ getDiscountPercent(product) }}% OFF
                </div>

                <!-- BADGE STOK HABIS -->
                <div
                  v-if="product.stock <= 0"
                  class="absolute top-2 right-2 z-10 mono label-xs px-2 py-0.5 rounded-full bg-[#9b3a2e] text-[#faf6ee]"
                >
                  STOK HABIS
                </div>

                <!-- GAMBAR PRODUK -->
                <div
                  class="h-24 sm:h-32 bg-[#f4eee3] flex items-center justify-center border-b border-[#2b1b12]/10"
                >
                  <img
                    v-if="product.image"
                    :src="product.image"
                    :alt="product.name"
                    class="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <svg
                    v-else
                    width="30"
                    height="30"
                    viewBox="0 0 34 34"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 13h18v7a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7v-7Z"
                      stroke="#C9B8A2"
                      stroke-width="1.6"
                    />
                    <path
                      d="M24 15h2.5a3.5 3.5 0 0 1 0 7H24"
                      stroke="#C9B8A2"
                      stroke-width="1.6"
                    />
                  </svg>
                </div>

                <!-- INFO PRODUK -->
                <div class="p-3.5 sm:p-4 flex flex-col justify-between flex-1">
                  <div>
                    <!-- LABEL KATEGORI KECIL -->
                    <span
                      v-if="product.category?.name"
                      class="mono text-[0.6rem] font-semibold tracking-wider uppercase text-[#b8763c] block mb-1"
                    >
                      {{ product.category.name }}
                    </span>

                    <h3
                      class="display text-xs sm:text-sm font-bold text-[#2b1b12] leading-snug mb-2"
                    >
                      {{ product.name }}
                    </h3>

                    <!-- HARGA -->
                    <div class="flex items-baseline gap-2 flex-wrap">
                      <p class="display text-sm sm:text-base font-bold text-[#b8763c]">
                        Rp
                        {{ getFinalPrice(product).toLocaleString("id-ID") }}
                      </p>
                      <p
                        v-if="Number(product.discount) > 0"
                        class="mono text-xs line-through text-[#8A7A68]"
                      >
                        Rp {{ Number(product.price).toLocaleString("id-ID") }}
                      </p>
                    </div>
                  </div>

                  <!-- TOMBOL TAMBAH -->
                  <div
                    class="mt-3.5 sm:mt-4 pt-3 border-t border-[#2b1b12]/10 flex items-center justify-between gap-2"
                  >
                    <span
                      class="mono text-[0.65rem]"
                      :class="
                        product.stock <= 0
                          ? 'text-[#9b3a2e] font-semibold'
                          : 'text-[#8A7A68]'
                      "
                    >
                      {{
                        product.stock <= 0
                          ? "HABIS"
                          : `STOK: ${product.stock}`
                      }}
                    </span>

                    <button
                      @click="addToCart(product)"
                      :disabled="
                        product.stock <= 0 ||
                        cartQtyOf(product.id) >= product.stock
                      "
                      class="btn-add mono inline-flex items-center gap-1.5 shrink-0"
                    >
                      <span>{{
                        product.stock <= 0 ? "HABIS" : "+ TAMBAH"
                      }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SIDEBAR KERANJANG / STATUS PESANAN -->
        <div class="lg:col-span-1 lg:sticky lg:top-24">
          <div class="ticket-card p-4 sm:p-5 md:p-6 space-y-5">
            <!-- MODE: SEDANG BELANJA -->
            <template v-if="!activeOrderId">
              <div class="flex items-center justify-between">
                <h3 class="display text-base font-bold text-[#2b1b12]">
                  Keranjang
                </h3>
                <span class="mono label-xs text-[#8A7A68]"
                  >{{ cart.length }} jenis</span
                >
              </div>

              <div v-if="cart.length === 0" class="py-8 text-center">
                <p class="mono text-xs text-[#8A7A68]">
                  Keranjang masih kosong.<br />Klik "+ Tambah" pada menu.
                </p>
              </div>

              <div v-else class="space-y-3 max-h-72 sm:max-h-80 overflow-y-auto pr-1">
                <div
                  v-for="item in cart"
                  :key="item.productId"
                  class="flex items-center justify-between gap-2 pb-3 border-b border-[#2b1b12]/10 last:border-0"
                >
                  <div class="flex-1 min-w-0">
                    <p
                      class="mono text-xs font-semibold text-[#2b1b12] truncate"
                    >
                      {{ item.name }}
                    </p>
                    <div class="flex items-center gap-1.5">
                      <p class="mono text-[0.7rem] text-[#8A7A68]">
                        Rp {{ item.price.toLocaleString("id-ID") }}
                      </p>
                      <span
                        v-if="item.discountPercent > 0"
                        class="mono text-[0.65rem] text-[#9b3a2e] font-bold"
                      >
                        (-{{ item.discountPercent }}%)
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0">
                    <button @click="decrementQty(item)" class="qty-btn">
                      −
                    </button>
                    <span class="mono text-xs w-5 text-center">{{
                      item.quantity
                    }}</span>
                    <button
                      @click="incrementQty(item)"
                      :disabled="item.quantity >= item.stock"
                      class="qty-btn"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div
                v-if="cart.length > 0"
                class="pt-3 border-t border-[#2b1b12]/10 space-y-3"
              >
                <div
                  class="flex justify-between mono text-sm font-bold text-[#2b1b12]"
                >
                  <span>Subtotal</span>
                  <span>Rp {{ cartSubtotal.toLocaleString("id-ID") }}</span>
                </div>

                <input
                  v-model="customerName"
                  type="text"
                  placeholder="Nama Anda (opsional)"
                  class="field w-full text-xs"
                  maxlength="100"
                />
                <textarea
                  v-model="note"
                  placeholder="Catatan (opsional), misal: less sugar"
                  class="field w-full text-xs"
                  rows="2"
                  maxlength="300"
                ></textarea>

                <p v-if="submitError" class="mono text-[0.7rem] text-[#9b3a2e]">
                  {{ submitError }}
                </p>

                <button
                  @click="submitOrder"
                  :disabled="submitting"
                  class="btn-submit mono w-full"
                >
                  {{ submitting ? "MENGIRIM..." : "KIRIM PESANAN KE KASIR" }}
                </button>
              </div>
            </template>

            <!-- MODE: PESANAN SUDAH DIKIRIM -->
            <template v-else>
              <div class="flex items-center justify-between">
                <h3 class="display text-base font-bold text-[#2b1b12]">
                  Status Pesanan
                </h3>
                <span
                  :class="statusBadgeClass"
                  class="mono label-xs px-2 py-0.5 rounded-full"
                >
                  {{ statusLabel }}
                </span>
              </div>

              <div v-if="orderStatus" class="space-y-3">
                <div class="space-y-2 max-h-56 sm:max-h-64 overflow-y-auto pr-1">
                  <div
                    v-for="item in orderStatus.items"
                    :key="item.id"
                    class="flex items-center justify-between gap-2 pb-2 border-b border-[#2b1b12]/10 last:border-0"
                  >
                    <p class="mono text-xs text-[#2b1b12]">
                      {{ item.productName }}
                      <span class="text-[#8A7A68]">×{{ item.quantity }}</span>
                    </p>
                    <p class="mono text-xs text-[#2b1b12]">
                      Rp
                      {{
                        (Number(item.price) * item.quantity).toLocaleString(
                          "id-ID",
                        )
                      }}
                    </p>
                  </div>
                </div>

                <div class="pt-3 border-t border-[#2b1b12]/10 space-y-1.5">
                  <div class="flex justify-between mono text-xs text-[#8A7A68]">
                    <span>Subtotal</span>
                    <span
                      >Rp {{ requestSubtotal.toLocaleString("id-ID") }}</span
                    >
                  </div>

                  <div
                    v-if="
                      orderStatus.order &&
                      Number(orderStatus.order.discount) > 0
                    "
                    class="flex justify-between mono text-xs text-[#2f7a46]"
                  >
                    <span>Diskon</span>
                    <span
                      >− Rp
                      {{
                        Number(orderStatus.order.discount).toLocaleString(
                          "id-ID",
                        )
                      }}</span
                    >
                  </div>

                  <div
                    class="flex justify-between mono text-sm font-bold text-[#2b1b12] pt-1"
                  >
                    <span>Total</span>
                    <span>
                      Rp
                      {{
                        (orderStatus.order
                          ? Number(orderStatus.order.totalAmount)
                          : requestSubtotal
                        ).toLocaleString("id-ID")
                      }}
                    </span>
                  </div>
                </div>

                <p class="mono text-[0.7rem] text-[#8A7A68] text-center pt-2">
                  {{ statusHelperText }}
                </p>

                <button
                  v-if="orderStatus.status !== 'PENDING'"
                  @click="resetOrder"
                  class="btn-submit mono w-full"
                >
                  PESAN LAGI
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <footer class="pt-4 pb-2 text-center">
        <p class="mono label-xs text-[#8A7A68]/70">
          Developed by Bayu Albar Ladici
        </p>
      </footer>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  layout: false,
});

useHead({
  link: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
    },
  ],
});

const { data: response, pending, error } = await useFetch("/api/menu");
const products = computed(() => response.value?.data || []);
const query = ref("");
const selectedCategory = ref(null);

const today = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})
  .format(new Date())
  .toUpperCase();

const selectCategory = (catId) => {
  selectedCategory.value = catId;
};

// 1. Menghitung persentase diskon secara otomatis dari nominal potongan
const getDiscountPercent = (product) => {
  const price = Number(product.price) || 0;
  const discount = Number(product.discount) || 0;
  if (price <= 0 || discount <= 0) return 0;

  return Math.round((discount / price) * 100);
};

// 2. Menghitung harga akhir setelah dikurangi nominal potongan
const getFinalPrice = (product) => {
  const price = Number(product.price) || 0;
  const discount = Number(product.discount) || 0;
  return Math.max(0, price - discount);
};

const categories = computed(() => {
  const map = new Map();
  for (const product of products.value) {
    if (product.category?.id != null) {
      map.set(product.category.id, product.category.name);
    }
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
});

// Semua produk digabung jadi satu list (tidak dikelompokkan per kategori),
// supaya kartu produk mengisi grid secara horizontal & tidak menyisakan
// ruang kosong ketika satu kategori cuma punya sedikit item.
const filteredProducts = computed(() => {
  const q = query.value.trim().toLowerCase();

  let filtered = products.value;

  if (selectedCategory.value !== null) {
    filtered = filtered.filter(
      (p) => p.category?.id === selectedCategory.value,
    );
  }

  if (q) {
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }

  return filtered;
});

// ================== TOAST ALERT ==================
const alertMessage = ref("");
const alertType = ref("success");
const showAlert = ref(false);
let alertTimeout = null;

function triggerAlert(msg, type = "success") {
  if (alertTimeout) clearTimeout(alertTimeout);
  alertMessage.value = msg;
  alertType.value = type;
  showAlert.value = true;
  alertTimeout = setTimeout(() => {
    showAlert.value = false;
  }, 3000);
}

// ================== KERANJANG ==================
const CART_STORAGE_KEY = "guest_cart";
const ORDER_ID_STORAGE_KEY = "guest_active_order_request";

const cart = ref([]);
const customerName = ref("");
const note = ref("");
const submitting = ref(false);
const submitError = ref("");

const cartQtyOf = (productId) => {
  const item = cart.value.find((i) => i.productId === productId);
  return item ? item.quantity : 0;
};

const addToCart = (product) => {
  if (product.stock <= 0) return;
  const existing = cart.value.find((i) => i.productId === product.id);
  if (existing) {
    if (existing.quantity < product.stock) existing.quantity++;
    return;
  }

  const discountPercent = getDiscountPercent(product);
  const finalPrice = getFinalPrice(product);

  cart.value.push({
    productId: product.id,
    name: product.name,
    price: finalPrice,
    discountPercent: discountPercent,
    quantity: 1,
    stock: product.stock,
  });
};

const incrementQty = (item) => {
  if (item.quantity < item.stock) item.quantity++;
};
const decrementQty = (item) => {
  item.quantity--;
  if (item.quantity <= 0) {
    cart.value = cart.value.filter((i) => i.productId !== item.productId);
  }
};

const cartSubtotal = computed(() =>
  cart.value.reduce((sum, i) => sum + i.price * i.quantity, 0),
);

const persistCart = () => {
  if (process.client) {
    sessionStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        cart: cart.value,
        customerName: customerName.value,
        note: note.value,
      }),
    );
  }
};

watch([cart, customerName, note], persistCart, { deep: true });

// ================== KIRIM & STATUS PESANAN ==================
const activeOrderId = ref(null);
const orderStatus = ref(null);
let pollTimer = null;

const requestSubtotal = computed(() => {
  if (!orderStatus.value) return 0;
  return orderStatus.value.items.reduce(
    (sum, i) => sum + Number(i.price) * i.quantity,
    0,
  );
});

const statusLabel = computed(() => {
  switch (orderStatus.value?.status) {
    case "ACCEPTED":
      return "Diterima Kasir";
    case "REJECTED":
      return "Ditolak";
    default:
      return "Menunggu Kasir";
  }
});

const statusBadgeClass = computed(() => {
  switch (orderStatus.value?.status) {
    case "ACCEPTED":
      return "bg-[#2f7a46]/10 text-[#2f7a46]";
    case "REJECTED":
      return "bg-[#9b3a2e]/10 text-[#9b3a2e]";
    default:
      return "bg-[#b8763c]/10 text-[#b8763c]";
  }
});

const statusHelperText = computed(() => {
  switch (orderStatus.value?.status) {
    case "ACCEPTED":
      return "Pesanan Anda sedang disiapkan. Silakan tunggu di kasir.";
    case "REJECTED":
      return "Mohon maaf, pesanan tidak dapat diproses. Silakan hubungi kasir.";
    default:
      return "Pesanan Anda sedang menunggu konfirmasi kasir...";
  }
});

watch(
  () => orderStatus.value?.status,
  (newStatus, oldStatus) => {
    if (!oldStatus || newStatus === oldStatus) return;
    if (newStatus === "ACCEPTED") {
      triggerAlert("Pesanan Anda diterima kasir! Silakan tunggu.", "success");
    } else if (newStatus === "REJECTED") {
      triggerAlert("Mohon maaf, pesanan Anda ditolak kasir.", "error");
    }
  },
);

const submitOrder = async () => {
  if (submitting.value || cart.value.length === 0) return;
  submitError.value = "";
  submitting.value = true;

  try {
    const res = await $fetch("/api/menu/order-request", {
      method: "POST",
      body: {
        customerName: customerName.value || null,
        note: note.value || null,
        items: cart.value.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      },
    });

    activeOrderId.value = res.orderRequestId;
    cart.value = [];
    if (process.client) {
      sessionStorage.removeItem(CART_STORAGE_KEY);
      sessionStorage.setItem(ORDER_ID_STORAGE_KEY, res.orderRequestId);
    }
    startPolling();

    triggerAlert(
      "Pesanan Anda berhasil dikirim! Silakan menuju kasir.",
      "success",
    );
  } catch (err) {
    const msg =
      err?.data?.statusMessage || "Gagal mengirim pesanan. Coba lagi.";
    submitError.value = msg;
    triggerAlert(msg, "error");
  } finally {
    submitting.value = false;
  }
};

const fetchOrderStatus = async () => {
  if (!activeOrderId.value) return;
  try {
    const res = await $fetch(`/api/menu/order-request/${activeOrderId.value}`);
    orderStatus.value = res.data;

    if (res.data.status !== "PENDING" && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch {
    resetOrder();
  }
};

const startPolling = () => {
  fetchOrderStatus();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchOrderStatus, 3000);
};

const resetOrder = () => {
  activeOrderId.value = null;
  orderStatus.value = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (process.client) sessionStorage.removeItem(ORDER_ID_STORAGE_KEY);
};

onMounted(() => {
  if (process.client) {
    const savedOrderId = sessionStorage.getItem(ORDER_ID_STORAGE_KEY);
    if (savedOrderId) {
      activeOrderId.value = savedOrderId;
      startPolling();
    } else {
      const savedCart = sessionStorage.getItem(CART_STORAGE_KEY);
      if (savedCart) {
        try {
          const parsed = JSON.parse(savedCart);
          cart.value = parsed.cart || [];
          customerName.value = parsed.customerName || "";
          note.value = parsed.note || "";
        } catch {}
      }
    }
  }
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.display {
  font-family: "Space Grotesk", sans-serif;
}

.mono {
  font-family: "IBM Plex Mono", monospace;
}

.label-xs {
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.stage {
  background-color: #1c1410;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(250, 246, 238, 0.05) 1px,
    transparent 0
  );
  background-size: 22px 22px;
}

.glow {
  background: radial-gradient(
    circle,
    rgba(184, 118, 60, 0.16) 0%,
    transparent 70%
  );
  filter: blur(10px);
}

.ticket-wrap {
  position: relative;
  filter: drop-shadow(0 20px 35px rgba(0, 0, 0, 0.45));
}

.spike-hole {
  position: absolute;
  top: -11px;
  left: 24px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #1c1410;
  border: 1.5px solid #b8763c;
  box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
  z-index: 20;
}

@media (min-width: 640px) {
  .spike-hole {
    top: -11px;
    left: 40px;
    width: 22px;
    height: 22px;
  }
}

.ticket {
  background: #faf6ee;
  border-radius: 6px;
  position: relative;
}

.ticket-card {
  background: #faf6ee;
  border-radius: 6px;
  border: 1.5px solid rgba(43, 27, 18, 0.12);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  position: relative;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.field {
  background: #f4eee3;
  border: 1.5px solid rgba(43, 27, 18, 0.15);
  border-radius: 6px;
  padding: 0.65rem 0.9rem;
  font-size: 0.85rem;
  font-family: "IBM Plex Mono", monospace;
  color: #2b1b12;
  /* mencegah zoom otomatis di iOS saat fokus input */
  font-size: max(0.85rem, 16px);
}

@media (min-width: 640px) {
  .field {
    font-size: 0.85rem;
  }
}

.field::placeholder {
  color: #b3a693;
}

.field:focus {
  outline: none;
  border-color: #b8763c;
}

.btn-add {
  background: #2b1b12;
  color: #faf6ee;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease;
  min-height: 30px;
}

.btn-add:hover:not(:disabled) {
  background: #b8763c;
}

.btn-add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-submit {
  background: #b8763c;
  color: #faf6ee;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.85rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  min-height: 44px;
}

.btn-submit:hover:not(:disabled) {
  background: #a1662f;
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.qty-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(43, 27, 18, 0.2);
  border-radius: 6px;
  background: #f4eee3;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.85rem;
  color: #2b1b12;
  cursor: pointer;
}

.qty-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.skeleton-card {
  overflow: hidden;
}

.skeleton-line {
  background: linear-gradient(90deg, #ece3d4 25%, #f4eee3 37%, #ece3d4 63%);
  background-size: 400% 100%;
  border-radius: 4px;
  animation: shimmer 1.4s ease infinite;
}

@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
}

/* ==== FILTER KATEGORI ==== */
.category-pill {
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
  background: #f4eee3;
  color: #8a7a68;
  border: 1px solid rgba(43, 27, 18, 0.12);
  transition: all 0.15s ease;
  cursor: pointer;
  min-height: 32px;
}

.category-pill:hover {
  background: #ecdfc9;
}

.category-pill--active {
  background: #b8763c;
  color: #faf6ee;
  border-color: #b8763c;
}

.no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.25s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-line,
  .ticket-card {
    animation: none !important;
    transition: none !important;
  }
}
</style>