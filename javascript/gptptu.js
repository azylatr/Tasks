/**
 * Copyright (c) 2025 darmawn (Aiyaas). All Rights Reserved.
 * (GPTPTU) Global processing text from the prompt on the user.
 *
 * @global
 */
"use strict";

function g_from(prompt) {
  // Convert the incoming prompt to an array[] or syllables
  const ft_list = prompt
    .toLowerCase()
    .split(" ")
    .filter((item) => item.length > 0);

  let _set = new Set(); // Object set

  ft_list.forEach((array) => {
    return array
      .split(/\s+/) 
      .forEach((e) => _set.add(e))
  });
  
  let lowCase = prompt.toLowerCase().split(/\s+/);
  let filter = lowCase.filter((w) => _set.has(w));

  if (filter.length > 10) {
    // To combine relevant words (can be improved significantly)
    const shuffel = [...filter, "_"]
      .sort(() => 0.5 - Math.random())
      .slice(0, prompt.length) // Take the number of incoming prompts and change it to (length) for the number of responses from the model
      .join(" ");

    console.table(filter)

    return shuffel;
  } else {
    // Alternative when the prompt entered by the user is too short
    const suggestion = Array.from(_set)
      .sort(() => 0.5 - Math.random())
      .slice(0, 20)
      .join(" ");

    return `I may not understand, maybe you mean (${suggestion})?`;
  }
}
 
/**
 * @exports from module 
 */
exports.g_from = g_from;
