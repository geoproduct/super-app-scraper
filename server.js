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
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  
  if (!apiKey) {
    return res.json({ jobs: [], error: 'API key missing' });
  }
  
  try {
    const targetUrl = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`;
    const scrapingbeeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render_js=false`;
    
    const response = await fetch(scrapingbeeUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // 더 유연한 파싱
    const jobs = [];
    
    // 제목과 회사명을 동시에 찾기
    const jobPattern = /<div[^>]*class="item_recruit"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    
    let match;
    let count = 0;
    
    while ((match = jobPattern.exec(html)) !== null && count < 20) {
      const block = match[1];
      
      // 제목 추출
      const titleMatch = block.match(/class="job_tit"[^>]*><a[^>]*>([^<]+)</i) || 
                        block.match(/class="str_tit"[^>]*title="([^"]+)"/i);
      
      // 회사명 추출
      const companyMatch = block.match(/class="corp_name"[^>]*><a[^>]*>([^<]+)</i) ||
                          block.match(/class="str_company"[^>]*>([^<]+)</i);
      
      // 링크 추출
      const linkMatch = block.match(/href="(\/zf_user\/jobs\/relay\/view[^"]+)"/i);
      
      if (titleMatch && companyMatch) {
        jobs.push({
          title: (titleMatch[1] || titleMatch[2] || '').trim(),
          company: (companyMatch[1] || companyMatch[2] || '').trim(),
          location: '서울/경기',
          salary: '회사 내규',
          link: linkMatch ? `https://www.saramin.co.kr${linkMatch[1]}` : targetUrl
        });
        count++;
      }
    }
    
    // 파싱 실패시 최소한의 결과라도 반환
    if (jobs.length === 0) {
      jobs.push({
        title: `${query} 관련 채용`,
        company: '사람인',
        location: '전국',
        salary: '경력 및 회사 내규에 따름',
        link: targetUrl
      });
    }
    
    console.log(`ScrapingBee: Found ${jobs.length} jobs for: ${query}`);
    res.json({ jobs, count: jobs.length });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
