const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

// 디버깅용 엔드포인트
app.get('/debug/:site', async (req, res) => {
  const { site } = req.params;
  const query = 'programmer';
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    let url;
    if (site === 'jobkorea') {
      url = `https://www.jobkorea.co.kr/Search/?stext=${query}`;
    } else if (site === 'incruit') {
      url = `https://www.incruit.com/search/search.asp?col=job&kw=${query}`;
    } else if (site === 'wanted') {
      url = `https://www.wanted.co.kr/search?query=${query}`;
    } else if (site === 'linkedin') {
      url = `https://www.linkedin.com/jobs/search/?keywords=${query}&location=South%20Korea`;
    }
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const html = await page.content();
    
    // 주요 셀렉터 테스트
    const selectors = [
      '.recruit-info',
      '.list-post',
      'article',
      '.job-card',
      '.list-item',
      '[data-cy="job-card"]',
      '.base-card',
      '.n_job_list_default',
      '.cell_mid',
      'li.list',
      'div.item'
    ];
    
    const selectorResults = {};
    for (const sel of selectors) {
      const count = await page.$$eval(sel, els => els.length).catch(() => 0);
      if (count > 0) {
        selectorResults[sel] = count;
      }
    }
    
    await browser.close();
    
    res.json({
      site,
      url,
      foundSelectors: selectorResults,
      htmlLength: html.length,
      htmlPreview: html.substring(0, 5000)
    });
    
  } catch (error) {
    if (browser) await browser.close();
    res.json({ error: error.message });
  }
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query, regions = [], maxExperience = '', maxEducation = '', maxPages = 5 } = req.body;
  
  let browser;
  const allJobs = [];
  const stats = { saramin: 0, jobkorea: 0, incruit: 0, wanted: 0, linkedin: 0 };
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('🔍 Query:', query);
    
    // 사람인
    console.log('📍 Saramin...');
    for (let p = 1; p <= maxPages; p++) {
      try {
        const jobs = await scrapeSaramin(browser, query, p);
        allJobs.push(...jobs);
        stats.saramin += jobs.length;
        console.log(`  P${p}: ${jobs.length}`);
        if (jobs.length === 0) break;
      } catch (e) {
        console.error(`Saramin error:`, e.message);
        break;
      }
    }
    
    // 잡코리아 - 개선된 버전
    console.log('📍 JobKorea...');
    for (let p = 1; p <= maxPages; p++) {
      try {
        const jobs = await scrapeJobKorea(browser, query, p);
        allJobs.push(...jobs);
        stats.jobkorea += jobs.length;
        console.log(`  P${p}: ${jobs.length}`);
        if (jobs.length === 0) break;
      } catch (e) {
        console.error(`JobKorea error:`, e.message);
        break;
      }
    }
    
    // 인크루트
    console.log('📍 Incruit...');
    for (let p = 1; p <= 3; p++) {
      try {
        const jobs = await scrapeIncruit(browser, query, p);
        allJobs.push(...jobs);
        stats.incruit += jobs.length;
        console.log(`  P${p}: ${jobs.length}`);
        if (jobs.length === 0) break;
      } catch (e) {
        console.error(`Incruit error:`, e.message);
        break;
      }
    }
    
    // 원티드
    console.log('📍 Wanted...');
    try {
      const jobs = await scrapeWanted(browser, query);
      allJobs.push(...jobs);
      stats.wanted += jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Wanted error:`, e.message);
    }
    
    await browser.close();
    console.log('📊', stats);
    
    // 필터링
    let filtered = allJobs;
    
    if (regions.length > 0) {
      filtered = filtered.filter(j => regions.some(r => j.location.includes(r)));
    }
    
    if (maxExperience) {
      const maxExp = parseInt(maxExperience);
      filtered = filtered.filter(j => {
        if (!j.experience) return true;
        if (j.experience.includes('신입') || j.experience.includes('무관')) return true;
        const m = j.experience.match(/(\d+)/);
        return m ? parseInt(m[1]) <= maxExp : true;
      });
    }
    
    if (maxEducation) {
      const edu = ['학력무관', '고졸', '초대졸', '대졸', '석사', '박사'];
      const allowed = edu.slice(0, parseInt(maxEducation) + 1);
      filtered = filtered.filter(j => !j.education || allowed.some(e => j.education.includes(e)));
    }
    
    console.log(`✅ ${allJobs.length} -> ${filtered.length}`);
    res.json({ jobs: filtered, total: allJobs.length, filtered: filtered.length, stats });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌', error.message);
    res.json({ jobs: [], total: 0, filtered: 0, error: error.message });
  }
});

async function scrapeSaramin(browser, query, page) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await p.goto(`https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}&recruitPage=${page}`, 
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
  
  const jobs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('.item_recruit')).map(el => {
      const cond = el.querySelectorAll('.job_condition span');
      return {
        title: el.querySelector('.job_tit a')?.innerText.trim() || '',
        company: el.querySelector('.corp_name a')?.innerText.trim() || '',
        location: cond[0]?.innerText.trim() || '',
        experience: cond[1]?.innerText.trim() || '',
        education: cond[2]?.innerText.trim() || '',
        link: el.querySelector('.job_tit a')?.href || '',
        source: 'Saramin'
      };
    }).filter(j => j.title && j.company);
  });
  
  await p.close();
  return jobs;
}

async function scrapeJobKorea(browser, query, pageNum) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${pageNum}`;
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await p.waitForTimeout(3000);
  
  // HTML 구조 확인
  const html = await p.content();
  console.log(`JobKorea HTML length: ${html.length}`);
  
  const jobs = await p.evaluate(() => {
    const results = [];
    
    // 모든 가능한 셀렉터 시도
    const possibleSelectors = [
      'article.list-item',
      '.recruit-info',
      'li.list-post',
      'div.post-list-info',
      '[class*="recruit"]',
      '[class*="job"]',
      'article'
    ];
    
    for (const selector of possibleSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`Trying ${selector}: ${elements.length} elements`);
      
      if (elements.length > 0) {
        elements.forEach(el => {
          // 여러 방법으로 제목 찾기
          const titleEl = el.querySelector('a.title, a[class*="title"], h3 a, h4 a, .job-tit a, a strong');
          const companyEl = el.querySelector('.company, .company-name, .corp-name, [class*="company"] a, [class*="corp"]');
          
          if (titleEl) {
            const title = titleEl.textContent?.trim() || titleEl.innerText?.trim() || '';
            const company = companyEl?.textContent?.trim() || companyEl?.innerText?.trim() || '회사명없음';
            
            if (title && title.length > 3) {
              results.push({
                title,
                company,
                location: el.querySelector('[class*="loc"], [class*="location"], .region')?.textContent?.trim() || '',
                experience: el.querySelector('[class*="exp"], [class*="career"]')?.textContent?.trim() || '',
                education: el.querySelector('[class*="edu"]')?.textContent?.trim() || '',
                link: titleEl.href || titleEl.closest('a')?.href || '',
                source: 'JobKorea'
              });
            }
          }
        });
        
        if (results.length > 0) break;
      }
    }
    
    return results;
  });
  
  await p.close();
  return jobs.filter(j => j.title && j.company);
}

async function scrapeIncruit(browser, query, pageNum) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.incruit.com/search/search.asp?col=job&kw=${encodeURIComponent(query)}&page=${pageNum}`;
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(2000);
  
  const jobs = await p.evaluate(() => {
    const results = [];
    const selectors = [
      '.n_job_list_default',
      '.cell_mid',
      'li.list',
      'div[class*="job"]',
      'table tr'
    ];
    
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        elements.forEach(el => {
          const titleEl = el.querySelector('a[href*="view"]');
          const companyEl = el.querySelector('.company, [class*="company"]');
          
          if (titleEl) {
            results.push({
              title: titleEl.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '회사명없음',
              location: el.querySelector('[class*="area"], [class*="loc"]')?.textContent?.trim() || '',
              experience: '',
              education: '',
              link: titleEl.href?.includes('http') ? titleEl.href : `https://www.incruit.com${titleEl.getAttribute('href')}`,
              source: 'Incruit'
            });
          }
        });
        if (results.length > 0) break;
      }
    }
    
    return results.filter(j => j.title && j.title.length > 3);
  });
  
  await p.close();
  return jobs;
}

async function scrapeWanted(browser, query) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.wanted.co.kr/search?query=${encodeURIComponent(query)}`;
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await p.waitForTimeout(5000);
  
  const jobs = await p.evaluate(() => {
    const results = [];
    const selectors = [
      '[data-cy="job-card"]',
      'div[class*="JobCard"]',
      'div[class*="job"]',
      'article',
      'li[class*="job"]'
    ];
    
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        elements.forEach(el => {
          const titleEl = el.querySelector('a, h3, h4, strong');
          const companyEl = el.querySelector('[class*="company"], [data-cy*="company"]');
          
          if (titleEl) {
            results.push({
              title: titleEl.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '회사명없음',
              location: el.querySelector('[class*="location"]')?.textContent?.trim() || '서울',
              experience: '',
              education: '',
              link: el.querySelector('a')?.href || '',
              source: 'Wanted'
            });
          }
        });
        if (results.length > 0) break;
      }
    }
    
    return results.filter(j => j.title && j.title.length > 3);
  });
  
  await p.close();
  return jobs.slice(0, 20);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server on ${PORT}`);
});
