const $ = selector => document.querySelector(selector);
let state = { recipes: [], menu: {}, shopping: [] };
let activeSlot = null;

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Une erreur est survenue.'); }
  return response.status === 204 ? null : response.json();
}

function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 2600); }
function recipeById(id) { return state.recipes.find(recipe => recipe.id === id); }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function renderMenu() {
  $('#menu-body').innerHTML = Object.entries(state.menu).map(([day, meals]) => `<tr><td class="day">${escapeHtml(day)}</td>${[['lunch','Midi'],['dinner','Soir']].map(([meal,label]) => { const recipe = recipeById(meals[meal]); return `<td class="meal-cell" data-label="${label}"><button class="meal-button ${recipe ? 'filled' : ''}" data-day="${escapeHtml(day)}" data-meal="${meal}">${recipe ? `<span>${label}</span>${escapeHtml(recipe.title)}` : `+ Choisir pour ${label.toLowerCase()}`}</button></td>`; }).join('')}</tr>`).join('');
  document.querySelectorAll('.meal-button').forEach(button => button.addEventListener('click', () => openPicker(button.dataset.day, button.dataset.meal)));
}

function renderRecipes() {
  const query = $('#recipe-search').value.toLocaleLowerCase('fr'); const favoritesOnly = $('#favorites-only').checked;
  const recipes = state.recipes.filter(recipe => (!favoritesOnly || recipe.favorite) && `${recipe.title} ${recipe.description} ${recipe.ingredients.join(' ')}`.toLocaleLowerCase('fr').includes(query));
  $('#recipe-grid').innerHTML = recipes.length ? recipes.map(recipe => `<article class="recipe-card" data-id="${recipe.id}" tabindex="0"><button class="favorite ${recipe.favorite ? 'active' : ''}" data-favorite="${recipe.id}" aria-label="${recipe.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">★</button><span class="eyebrow">${recipe.favorite ? 'Favori' : 'Recette'}</span><h3>${escapeHtml(recipe.title)}</h3><p>${escapeHtml(recipe.description || 'Une recette maison à découvrir.')}</p><footer><span>${recipe.ingredients.length} ingrédients</span><span>${recipe.preparation.length} étapes</span></footer></article>`).join('') : '<p class="empty">Aucune recette ne correspond à votre recherche.</p>';
  document.querySelectorAll('[data-favorite]').forEach(button => button.addEventListener('click', async event => { event.stopPropagation(); await request(`/api/recipes/${button.dataset.favorite}/favorite`, { method: 'PATCH' }); await load(); }));
  document.querySelectorAll('.recipe-card').forEach(card => { card.addEventListener('click', () => showRecipe(card.dataset.id)); card.addEventListener('keydown', event => { if (event.key === 'Enter') showRecipe(card.dataset.id); }); });
}

function renderShopping() {
  $('#shopping-list').innerHTML = state.shopping.map(item => `<li><input type="checkbox" data-check="${item.id}" ${item.checked ? 'checked' : ''} aria-label="Cocher ${escapeHtml(item.label)}"><span class="${item.checked ? 'checked' : ''}">${escapeHtml(item.label)}</span><button class="delete-item" data-delete="${item.id}" aria-label="Supprimer">×</button></li>`).join('');
  $('#shopping-empty').hidden = state.shopping.length > 0;
  const checked = state.shopping.filter(item => item.checked).length; $('#shopping-progress').textContent = state.shopping.length ? `${checked} article${checked > 1 ? 's' : ''} sur ${state.shopping.length} coché${checked > 1 ? 's' : ''}` : 'Prête pour votre prochaine semaine.';
  document.querySelectorAll('[data-check]').forEach(input => input.addEventListener('change', async () => { await request(`/api/shopping/${input.dataset.check}`, { method: 'PATCH' }); await load(); }));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => { await request(`/api/shopping/${button.dataset.delete}`, { method: 'DELETE' }); await load(); }));
}

function openPicker(day, meal) {
  activeSlot = { day, meal }; $('#picker-slot').textContent = `${day} · ${meal === 'lunch' ? 'Midi' : 'Soir'}`;
  const current = state.menu[day][meal]; $('#picker-list').innerHTML = `<button data-pick="">Aucune recette</button>${state.recipes.map(recipe => `<button data-pick="${recipe.id}">${current === recipe.id ? '✓ ' : ''}${escapeHtml(recipe.title)}</button>`).join('')}`;
  document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', async () => { await request('/api/menu', { method: 'PUT', body: JSON.stringify({ ...activeSlot, recipeId: button.dataset.pick || null }) }); $('#picker-dialog').close(); await load(); }));
  $('#picker-dialog').showModal();
}

function showRecipe(id) { const recipe = recipeById(id); $('#detail-title').textContent = recipe.title; $('#detail-description').textContent = recipe.description; $('#detail-ingredients').innerHTML = recipe.ingredients.map(item => `<li>${escapeHtml(item)}</li>`).join(''); $('#detail-preparation').innerHTML = recipe.preparation.map(item => `<li>${escapeHtml(item)}</li>`).join(''); $('#detail-dialog').showModal(); }

async function load() { state = await request('/api/state'); renderMenu(); renderRecipes(); renderShopping(); }
async function makeShoppingList() { state.shopping = await request('/api/shopping/from-menu', { method: 'POST' }); renderShopping(); notify('Liste de courses mise à jour.'); location.hash = '#shopping'; }

function showView() { const target = ['menu','recipes','shopping'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'menu'; document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== target); document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === target)); window.scrollTo({ top: 0, behavior: 'smooth' }); }

window.addEventListener('hashchange', showView); $('#recipe-search').addEventListener('input', renderRecipes); $('#favorites-only').addEventListener('change', renderRecipes); $('#open-recipe').addEventListener('click', () => $('#recipe-dialog').showModal()); document.querySelectorAll('.close-recipe').forEach(button => button.addEventListener('click', () => $('#recipe-dialog').close())); document.querySelectorAll('.close-detail').forEach(button => button.addEventListener('click', () => $('#detail-dialog').close())); $('#make-list').addEventListener('click', makeShoppingList); $('#make-list-secondary').addEventListener('click', makeShoppingList);
$('#shopping-form').addEventListener('submit', async event => { event.preventDefault(); await request('/api/shopping', { method: 'POST', body: JSON.stringify({ label: $('#shopping-input').value }) }); event.target.reset(); await load(); });
$('#recipe-form').addEventListener('submit', async event => { event.preventDefault(); const data = new FormData(event.target); await request('/api/recipes', { method: 'POST', body: JSON.stringify({ title: data.get('title'), description: data.get('description'), ingredients: data.get('ingredients').split('\n'), preparation: data.get('preparation').split('\n') }) }); event.target.reset(); $('#recipe-dialog').close(); await load(); notify('Recette ajoutée.'); });

showView(); load().catch(error => notify(error.message));
