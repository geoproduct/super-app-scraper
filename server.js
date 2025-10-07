const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { 
    query, 
    regions = [],
    maxExperience = '',
    maxEducation = '',
    maxPages = 5
  } = req.body;
  
  let browser;
  const allJobs = [];
  const stats = {
    saramin: 0,
    jobkorea: 0,
    incruit: 0,
    wanted: 0,
    linkedin: 0
  };
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('🔍 Starting scrape for:', query);
    
    // 1. 사람인
    try {
      console.log('📍 Scraping Saramin...');
      for (let page = 1; page <= maxPages; page++) {
        const jobs = await scrapeSaramin(browser, query, page);
        allJobs.push(...jobs);
        stats.saramin += jobs.length;
        console.log(`  Page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      }
    } catch (err) {
      console.error('❌ Saramin error:', err.message);
    }
    
    // 2. 잡코리아
    try {
      console.log('📍 Scraping JobKorea...');
      for (let page = 1; page <= maxPages; page++) {
        const jobs = await scrapeJobKorea(browser, query, page);
        allJobs.push(...jobs);
        stats.jobkorea += jobs.length;
        console.log(`  Page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      }
    } catch (err) {
      console.error('❌ JobKorea error:', err.message);
    }
    
    // 3. 인크루트
    try {
      console.log('📍 Scraping Incruit...');
      for (let page = 1; page <= maxPages; page++) {
        const jobs = await scrapeIncruit(browser, query, page);
        allJobs.push(...jobs);
        stats.incruit += jobs.length;
        console.log(`  Page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      }
    } catch (err) {
      console.error('❌ Incruit error:', err.message);
    }
    
    // 4. 원티드
    try {
      console.log('📍 Scraping Wanted...');
      for (let page = 1; page <= 3; page++) { // 원티드는 3페이지만
        const jobs = await scrapeWanted(browser, query, page);
        allJobs.push(...jobs);
        stats.wanted += jobs.length;
        console.log(`  Page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      }
    } catch (err) {
      console.error('❌ Wanted error:', err.message);
    }
    
    // 5. 링크드인
    try {
      console.log('📍 Scraping LinkedIn...');
      const jobs = await scrapeLinkedIn(browser, query);
      allJobs.push(...jobs);
      stats.linkedin += jobs.length;
      console.log(`  Total: ${jobs.length} jobs`);
    } catch (err) {
      console.error('❌ LinkedIn error:', err.message);
    }
    
    await browser.close();
    
    console.log('📊 Stats:', stats);
    
    // 스마트 필터링
    let filtered = allJobs;
    
    if (regions.length > 0) {
      filtered = filtered.filter(job => 
        regions.some(region => job.location.includes(region))
      );
    }
    
    if (maxExperience) {
      const maxExp = parseInt(maxExperience);
      filtered = filtered.filter(job => {
        if (!job.experience) return true;
        const exp = job.experience.toLowerCase();
        if (exp.includes('신입') || exp.includes('무관')) return true;
        const match = exp.match(/(\d+)/);
        if (match) {
          const requiredExp = parseInt(match[1]);
          return requiredExp <= maxExp;
        }
        return true;
      });
    }
    
    if (maxEducation) {
      const eduLevels = ['학력무관', '고졸', '초대졸', '대졸', '석사', '박사'];
      const maxEduIndex = parseInt(maxEducation);
      const allowedEdu = eduLevels.slice(0, maxEduIndex + 1);
      
      filtered = filtered.filter(job => {
        if (!job.education) return true;
        return allowedEdu.some(edu => job.education.includes(edu));
      });
    }
    
    console.log(`✅ Total: ${allJobs.length}, Filtered: ${filtered.length}`);
    res.json({ 
      jobs: filtered,
      total: allJobs.length,
      filtered: filtered.length,
      stats: stats
    });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Fatal error:', error.message);
    res.json({ jobs: [], total: 0, filtered: 0, error: error.message });
  }
});

// 사람인
async function scrapeSaramin(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}&recruitPage=${pageNum}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
  
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.item_recruit').forEach(el => {
      const conditions = el.querySelectorAll('.job_condition span');
      results.push({
        title: el.querySelector('.job_tit a')?.innerText.trim() || '',
        company: el.querySelector('.corp_name a')?.innerText.trim() || '',
        location: conditions[0]?.innerText.trim() || '',
        experience: conditions[1]?.innerText.trim() || '',
        education: conditions[2]?.innerText.trim() || '',
        link: el.querySelector('.job_tit a')?.href || '',
        source: 'Saramin'
      });
    });
    return results;
  });
  
  await page.close();
  return jobs.filter(job => job.title && job.company);
}

// 잡코리아
async function scrapeJobKorea(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${pageNum}`;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // 여러 셀렉터 시도
    await page.waitForSelector('.recruit-info, .list-post, article', { timeout: 10000 }).catch(() => {});
    
    const jobs = await page.evaluate(() => {
      const results = [];
      
      // 셀렉터 여러개 시도
      const selectors = ['.recruit-info', '.list-post article', 'article.list-item'];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach(el => {
            const titleEl = el.querySelector('.title, .post-list-corp-name a, h3 a');
            const companyEl = el.querySelector('.corp-name a, .company-name, .post-list-corp');
            const locEl = el.querySelector('.loc, .location, .option-corp-location');
            const expEl = el.querySelector('.exp, .career, .option-corp-career');
            const eduEl = el.querySelector('.edu, .education, .option-corp-education');
            
            if (titleEl && companyEl) {
              results.push({
                title: titleEl.innerText?.trim() || titleEl.textContent?.trim() || '',
                company: companyEl.innerText?.trim() || companyEl.textContent?.trim() || '',
                location: locEl?.innerText?.trim() || locEl?.textContent?.trim() || '지역정보없음',
                experience: expEl?.innerText?.trim() || expEl?.textContent?.trim() || '경력무관',
                education: eduEl?.innerText?.trim() || eduEl?.textContent?.trim() || '학력무관',
                link: titleEl.href || titleEl.closest('a')?.href || '',
                source: 'JobKorea'
              });
            }
          });
          break;
        }
      }
      
      return results;
    });
    
    await page.close();
    return jobs.filter(job => job.title && job.company);
    
  } catch (err) {
    await page.close();
    throw err;
  }
}

// 인크루트
async function scrapeIncruit(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.incruit.com/search/search.asp?col=job&kw=${encodeURIComponent(query)}&page=${pageNum}`;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.n_job_list_default, .cell_mid', { timeout: 10000 }).catch(() => {});
    
    const jobs = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.n_job_list_default, .cell_mid').forEach(el => {
        const titleEl = el.querySelector('.cl_top a, .cl_top_company');
        const companyEl = el.querySelector('.cl_btm_none a, .txt1 a');
        
        if (titleEl && companyEl) {
          results.push({
            title: titleEl.innerText?.trim() || '',
            company: companyEl.innerText?.trim() || '',
            location: el.querySelector('.cl_btm_none span, .txt2')?.innerText?.trim() || '지역정보없음',
            experience: '경력무관',
            education: '학력무관',
            link: titleEl.href || `https://www.incruit.com${titleEl.getAttribute('href')}`,
            source: 'Incruit'
          });
        }
      });
      return results;
    });
    
    await page.close();
    return jobs.filter(job => job.title && job.company);
  } catch (err) {
    await page.close();
    return [];
  }
}

// 원티드
async function scrapeWanted(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const offset = (pageNum - 1) * 20;
  const url = `https://www.wanted.co.kr/search?query=${encodeURIComponent(query)}&offset=${offset}`;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(2000); // 동적 렌더링 대기
    
    const jobs = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('div[data-cy="job-card"]').forEach(el => {
        const titleEl = el.querySelector('a strong, h3, h4');
        const companyEl = el.querySelector('span[data-cy="company-name"], .company-name');
        const locationEl = el.querySelector('span[data-cy="job-card-location"]');
        
        if (titleEl) {
          results.push({
            title: titleEl.innerText?.trim() || '',
            company: companyEl?.innerText?.trim() || '회사명없음',
            location: locationEl?.innerText?.trim() || '지역정보없음',
            experience: '경력무관',
            education: '학력무관',
            link: el.querySelector('a')?.href || '',
            source: 'Wanted'
          });
        }
      });
      return results;
    });
    
    await page.close();
    return jobs.filter(job => job.title);
  } catch (err) {
    await page.close();
    return [];
  }
}

// 링크드인
async function scrapeLinkedIn(browser, query) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=South%20Korea&f_TPR=r86400`;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const jobs = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.job-search-card, .base-card').forEach(el => {
        const titleEl = el.querySelector('.base-search-card__title, h3');
        const companyEl = el.querySelector('.base-search-card__subtitle, h4');
        const locationEl = el.querySelector('.job-search-card__location');
        const linkEl = el.querySelector('a.base-card__full-link');
        
        if (titleEl) {
          results.push({
            title: titleEl.innerText?.trim() || '',
            company: companyEl?.innerText?.trim() || '회사명없음',
            location: locationEl?.innerText?.trim() || 'South Korea',
            experience: '경력무관',
            education: '학력무관',
            link: linkEl?.href || '',
            source: 'LinkedIn'
          });
        }
      });
      return results;
    });
    
    await page.close();
    return jobs.filter(job => job.title).slice(0, 20);
  } catch (err) {
    await page.close();
    return [];
  }
}

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Time: ${new Date().toISOString()}`);
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
});

// 종료 처리
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
