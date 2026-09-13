Khi MCP server đóng vai trò là hub trung gian tổng hợp sản phẩm từ nhiều merchant cho AI Agent, bài toán không đơn thuần là xếp hạng trong 1 catalog mà là **Cross-Merchant Multi-Objective Ranking**.

Nếu triển khai LTR ngay từ đầu, hệ thống sẽ gặp vấn đề **Cold-Start** (chưa có tương tác click/convert từ agent) và **Merchant Variance** (mỗi shop mô tả dữ liệu một kiểu, độ tin cậy và giá ship khác nhau).

Phương pháp thực chiến và hiệu quả nhất là **Kiến trúc 3 tầng (Multi-Stage Ranking & Decision Protocol)**:

### **Tầng 1: Unified Normalization & Hard Candidate Retrieval**

Khi nhận query JSON từ AI Agent, không truy vấn thẳng vào từng merchant database dạng raw mà cần chuẩn hóa:

> 1. **Catalog Schema Standardization:**  
   * Chỉ dùng các trường đang có trong demo data: `sku`, `title`, category `name`/`slug`, `price_amount`, `currency`, `shipping_available`, `shipping_fee`, `estimated_days_min`, `estimated_days_max`, `average_rating`, `review_count`, `availability` và `stock_quantity`.  
> 2. **Deterministic Hard Filters:**  
   * Loại trừ ngay offer hết hàng (`stock_quantity <= 0`, `availability = out_of_stock/discontinued`), không hỗ trợ giao hàng (`shipping_available = 0`), merchant không ở trạng thái `active`, hoặc vi phạm các hard constraint từ query (`price_max`, `currency`, `availability`, `delivery_days_max`).  
> 3. **Hybrid Retrieval (Lọc thô Top 50–100 items):**  
   * Kết hợp Semantic Vector Search (embedding của query vs. embedding mô tả sản phẩm) và Attribute Filtering/BM25 để lấy ra top ứng viên từ tất cả các merchant.

### **Tầng 2: Multi-Objective Scoring (Thay thế LTR giai đoạn đầu)**

Giai đoạn đầu (khi chưa đủ dữ liệu conversion), thay vì dùng LTR thuần, hãy tính điểm theo hàm tiện ích đa mục tiêu (**Utility Function**) để cân bằng giữa sự phù hợp của sản phẩm và lợi ích thương mại:

&nbsp;

$$Score(item) \= w\_{rel} \\cdot S\_{rel} \+ w\_{price} \\cdot S\_{price} \+ w\_{trust} \\cdot S\_{trust} \+ w\_{fulfill} \\cdot S\_{fulfill}$$

Trọng số mặc định dùng trong demo: $w_{rel}=0.40$, $w_{price}=0.25$, $w_{trust}=0.20$, $w_{fulfill}=0.15$. Số requirement `VERIFIED_MATCH` vẫn là khóa xếp hạng chính; utility chỉ phân hạng các sản phẩm trong cùng bucket để không cho một sản phẩm rẻ hơn nhưng kém phù hợp vượt lên trên sản phẩm phù hợp hơn.

* **$S\_{rel}$ (Độ khớp sản phẩm):** Kết hợp semantic similarity ($S\_{sem}$) và attribute exact matching ($S\_{attr}$). Trọng số thường đặt $0.6 \\cdot S\_{attr} \+ 0.4 \\cdot S\_{sem}$.  
* **$S\_{price}$ (Độ cạnh tranh về giá):** Đo giá tương đối giữa các merchant trong cùng candidate set sau khi hard filter. `price_max` chỉ dùng để loại sản phẩm vượt ngân sách, không dùng làm mẫu số của điểm giá. Công thức mặc định dùng Min-Max Normalization:  
  $$S\_{price} = \\frac{\\text{Price}\_{max} - \\text{Price}\_{item}}{\\text{Price}\_{max} - \\text{Price}\_{min} + \\epsilon}$$  
  Sản phẩm rẻ nhất phiên đạt gần $1.0$ và sản phẩm đắt nhất đạt $0.0$. Mọi sản phẩm trong candidate set phải cùng currency hoặc đã được quy đổi về một currency chuẩn trước khi tính.  
  Khi cần phạt mạnh các sản phẩm đắt hơn trung vị của phiên, có thể dùng biến thể Sigmoid:  
  $$S\_{price} = \\frac{1}{1 + \\exp\\left(\\frac{\\text{Price}\_{item} - \\text{Price}\_{median}}{\\sigma}\\right)}$$  
* **$S\_{trust}$ (Độ tin cậy từ demo data):** Chỉ dựa trên `average_rating` và `review_count` của sản phẩm. Rating được chuẩn hóa về $[0,1]$ và điều chỉnh bằng độ tin cậy logarithmic từ số review.  
* **$S\_{fulfill}$ (Năng lực vận chuyển):** Chỉ dựa trên `shipping_fee`, `estimated_days_min` và `estimated_days_max` có trong offer. Điểm mặc định gồm 70% tốc độ giao (trung bình của cửa sổ min/max) và 30% phí ship, đều chuẩn hóa Min-Max trong candidate set. Khi có `delivery_days_max`, đây là hard filter trước khi tính điểm.

> **Lưu ý cân bằng merchant (Fairness & Diversity):** Không để 1 merchant chiếm trọn top gợi ý nếu các chỉ số tương đương. Áp dụng kỹ thuật MMR (Maximal Marginal Relevance) hoặc giới hạn tối đa $K$ sản phẩm cho mỗi merchant trong Top N.

### **Tối ưu phản hồi cho AI Agent qua giao thức MCP**

AI Agent không hành xử như người lướt web (không cuộn xem hàng chục kết quả). Agent cần quyết định nhanh và có cơ sở lý luận rõ ràng:

* **Chỉ trả về Top 3 – 5 options tối ưu nhất.**  
* **Đi kèm decision\_factors (giải thích lý do lựa chọn):**  
  Thay vì chỉ gửi JSON thô, hãy gắn tag tiêu biểu cho từng option để agent đưa ra lập luận cho end-user:  
  * Option 1: badge: "best\_overall" (Cân bằng tốt nhất giữa giá và độ uy tín).  
  * Option 2: badge: "lowest\_price" (Merchant A bán rẻ nhất nhưng giao chậm 2 ngày).  
  * Option 3: badge: "fastest\_delivery" (Merchant B giao trong ngày, giá cao hơn 5%).
