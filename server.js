// Server đơn giản dùng Express để phục vụ file tĩnh
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server mô phỏng quầy mượn sách chạy tại http://localhost:${PORT}`);
});
