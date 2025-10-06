const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  
  try {
    const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // HTML에서 채용공고 추출
    const jobs = [];
    const recruitPattern = /<div[^>]*class="[^"]*item_recruit[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    const titlePattern = /<a[^>]*class="[^"]*str_tit[^"]*"[^>]*title="([^"]+)"/i;
    const companyPattern = /<a[^>]*class="[^"]*str_company[^"]*"[^>]*>([^<]+)</i;
    const linkPattern = /<a[^>]*class="[^"]*str_tit[^"]*"[^>]*href="([^"]+)"/i;
    
    let match;
    let count = 0;
    
    while ((match = recruitPattern.exec(html)) !== null && count < 20) {
      const itemHtml = match[1];
      
      const titleMatch = titlePattern.exec(itemHtml);
      const companyMatch = companyPattern.exec(itemHtml);
      const linkMatch = linkPattern.exec(itemHtml);
      
      if (titleMatch && companyMatch) {
        jobs.push({
          title: titleMatch[1].trim(),
          company: companyMatch[1].trim(),
          location: '서울',
          salary: '회사 내규에 따름',
          link: linkMatch ? `https://www.saramin.co.kr${linkMatch[1]}` : url
        });
        count++;
      }
    }
    
    console.log(`Found ${jobs.length} jobs for query: ${query}`);
    res.json({ jobs, count: jobs.length });
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    res.json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
