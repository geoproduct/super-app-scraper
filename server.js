const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

// 실제 크롤링 - fetch API 사용
app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  
  try {
    const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    
    // 정규식으로 데이터 추출
    const titlePattern = /<a[^>]*class="str_tit"[^>]*>([^<]+)<\/a>/g;
    const companyPattern = /<a[^>]*class="str_company"[^>]*>([^<]+)<\/a>/g;
    
    const titles = [];
    const companies = [];
    
    let match;
    while ((match = titlePattern.exec(html)) !== null) {
      titles.push(match[1].trim());
    }
    while ((match = companyPattern.exec(html)) !== null) {
      companies.push(match[1].trim());
    }
    
    const jobs = titles.slice(0, 20).map((title, i) => ({
      title: title,
      company: companies[i] || '회사명 없음',
      location: '서울',
      salary: '협의',
      link: url
    }));
    
    console.log(`Found ${jobs.length} jobs for query: ${query}`);
    res.json({ jobs, count: jobs.length });
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    res.json({ 
      jobs: [],
      error: error.message 
    });
  }
});

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server on ${PORT}`);
});
